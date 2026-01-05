const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- CONFIGURATION ---
// We use localhost because of the SSH tunnel in Step 2
const PI_API = "http://localhost:11434/api/generate";

// --- MODEL SELECTION ---
const CHAT_MODEL = "gemma3:4b";         // Smart & Fast for conversation
const AGENT_MODEL = "deepseek-r1:7b"; // Thinking logic for building

// --- CPU USAGE SETTINGS ---
const CPU_THREADS = 3;  // Limit to 3 threads (Pi 5 has 4 cores, this uses 75%)
                        // Options: 1 (25%), 2 (50%), 3 (75%), 4 (100%)

// --- HELPER FUNCTIONS ---
function killOllamaProcesses() {
    return new Promise((resolve, reject) => {
        console.log('🛑 Stopping Ollama processes...');
        exec('pkill -9 ollama', (error, stdout, stderr) => {
            if (error && error.code !== 1) {
                // Code 1 means no processes found, which is okay
                console.error('Error killing processes:', error);
                reject(error);
            } else {
                console.log('✓ Ollama processes stopped. Ready for next request.');
                resolve();
            }
        });
    });
}

// --- PROMPTS ---
const CHAT_PROMPT = `
You are a helpful command-line assistant. Keep answers concise, accurate, and text-only.
Do NOT write code to save files. Just chat.
`;

const AGENT_PROMPT = `
You are an AUTONOMOUS BUILDER AGENT with file system access. When given a task, you MUST immediately create the necessary files and operations using the special syntax below.

AVAILABLE COMMANDS:
/cd <dir>       - Change directory
/mkdir <name>   - Create directory
/touch <file>   - Create empty file
/rm <file>      - Delete file (goes to Recycle Bin)
/rmdir <dir>    - Delete directory
/cp <src> <dst> - Copy file
/mv <src> <dst> - Move/rename file
/cat <file>     - View file contents
/ls             - List files
/pwd            - Show current directory

TO CREATE FILES WITH CONTENT - USE THIS SYNTAX:
<<<FILE: filename.ext>>>
[file content here - actual code, not descriptions]
<<<END>>>

TO PERFORM FILE OPERATIONS - USE THIS SYNTAX:
<<<OPERATION: /mkdir public>>>
<<<OPERATION: /cd public>>>
<<<OPERATION: /touch style.css>>>

CRITICAL RULES:
1. DO NOT just explain or plan - IMMEDIATELY create files using <<<FILE:>>> syntax
2. DO NOT write placeholder code - write complete, working code
3. When user asks "make a website", create the HTML/CSS/JS files directly
4. Use <<<OPERATION:>>> for any directory changes or file operations
5. User will approve each operation before execution
6. Keep explanations brief - focus on ACTION

EXAMPLE - User: "make a website that is a simple calculator"
YOUR RESPONSE:
<<<FILE: calculator.html>>>
<!DOCTYPE html>
<html>
<head>
    <title>Calculator</title>
    [complete working code here]
</head>
</html>
<<<END>>>

I'm creating a calculator website with HTML, CSS, and JavaScript.
`;

io.on('connection', (socket) => {
    console.log('User connected to Terminal');
    let currentMode = 'chat';
    let workingDirectory = __dirname; // Track current directory per connection

    // Send model names to client on connect
    socket.emit('modelInfo', {
        chatModel: CHAT_MODEL,
        agentModel: AGENT_MODEL
    });

    socket.on('switchMode', (newMode) => {
        currentMode = newMode;
        // No system messages needed - the UI toggle shows the mode
    });

    // --- NEW: CHAT MESSAGE HANDLER ---
    socket.on('chatMessage', async (data) => {
        const { text, image } = data;

        // Check for cancel command
        if (text && text.trim().toLowerCase() === '/cancel') {
            try {
                await killOllamaProcesses();
                socket.emit('chatResponse', '🛑 Process cancelled. All Ollama processes stopped.\n\nYou can start a new request anytime.');
            } catch (e) {
                socket.emit('chatResponse', '⚠️ Could not stop processes automatically. Try: pkill -9 ollama');
            }
            return;
        }

        let requestBody = {
            model: CHAT_MODEL,
            prompt: CHAT_PROMPT + "\nUser: " + text + "\nAssistant:",
            stream: false,
            options: {
                stop: ["User:", "Assistant:", "System:", "---"],
                num_thread: CPU_THREADS  // Limit CPU usage
            }
        };

        try {

            // If image is present, add base64 data (Ollama API format)
            if (image) {
                // Extract base64 data (remove data URL prefix if present)
                let base64Data;
                if (image.includes(',')) {
                    base64Data = image.split(',')[1];
                } else {
                    base64Data = image;
                }

                if (!base64Data) {
                    throw new Error('Failed to extract base64 data from image');
                }

                console.log('📸 Sending image request to', CHAT_MODEL);
                console.log('📊 Image size:', Math.round(base64Data.length / 1024), 'KB');

                // Ollama API format: base64 string in images array
                requestBody = {
                    model: CHAT_MODEL,
                    prompt: text || "What's in this image?",
                    images: [base64Data],
                    stream: false,
                    options: {
                        num_thread: CPU_THREADS  // Limit CPU usage
                    }
                };
            }

            const response = await axios.post(PI_API, requestBody);

            const aiText = response.data.response;
            socket.emit('chatResponse', aiText);

        } catch (e) {
            if (e.response && e.response.status === 400) {
                // 400 error - check what went wrong
                const errorMsg = e.response?.data?.error || 'Bad request';
                console.error('400 Error details:', errorMsg);

                socket.emit('chatResponse', `❌ Image Request Failed\n\nError: ${errorMsg}\n\n🔍 Possible issues:\n• Image file format not supported\n• Image too large or corrupted\n• Model configuration issue\n\n💡 Check server console for details`);
            } else {
                const errorDetails = e.response?.data?.error || e.message;
                console.error('Request error:', errorDetails);
                socket.emit('chatResponse', `❌ Error: ${errorDetails}`);
            }
        }
    });

    // --- TERMINAL COMMAND HANDLER (for Agent Mode) ---
    let pendingFiles = [];

    // Handle approval response from popup
    socket.on('approvalResponse', ({ approved }) => {
        if (approved) {
            let filesCount = 0;
            let opsCount = 0;

            for (const action of pendingFiles) {
                if (action.type === 'file') {
                    // Save file
                    fs.writeFileSync(path.join(workingDirectory, action.name), action.content);
                    socket.emit('termOutput', `\x1b[32m✔ SAVED: ${action.name}\x1b[0m\r\n`);
                    filesCount++;
                } else if (action.type === 'operation') {
                    // Execute operation
                    const cmd = action.command.trim();
                    const parts = cmd.split(' ');
                    const command = parts[0].toLowerCase();
                    const args = parts.slice(1);

                    try {
                        if (command === '/cd') {
                            const targetDir = args[0] === '..'
                                ? path.dirname(workingDirectory)
                                : path.resolve(workingDirectory, args.join(' '));

                            if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
                                workingDirectory = targetDir;
                                socket.emit('termOutput', `\x1b[32m✔ EXECUTED: ${cmd}\x1b[0m\r\n`);
                            } else {
                                socket.emit('termOutput', `\x1b[31m✗ Directory not found: ${args.join(' ')}\x1b[0m\r\n`);
                            }
                        } else if (command === '/mkdir') {
                            const newDir = path.join(workingDirectory, args.join(' '));
                            fs.mkdirSync(newDir, { recursive: true });
                            socket.emit('termOutput', `\x1b[32m✔ EXECUTED: ${cmd}\x1b[0m\r\n`);
                        } else if (command === '/touch') {
                            const filePath = path.join(workingDirectory, args.join(' '));
                            fs.writeFileSync(filePath, '');
                            socket.emit('termOutput', `\x1b[32m✔ EXECUTED: ${cmd}\x1b[0m\r\n`);
                        } else if (command === '/rm') {
                            const filePath = path.join(workingDirectory, args.join(' '));
                            const escapedPath = filePath.replace(/'/g, "''");
                            exec(`powershell -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escapedPath}', 'OnlyErrorDialogs', 'SendToRecycleBin')"`, (err) => {
                                if (err) {
                                    socket.emit('termOutput', `\x1b[31m✗ Failed to delete: ${args.join(' ')}\x1b[0m\r\n`);
                                } else {
                                    socket.emit('termOutput', `\x1b[32m✔ EXECUTED: ${cmd} (moved to Recycle Bin)\x1b[0m\r\n`);
                                }
                            });
                        } else if (command === '/rmdir') {
                            const dirPath = path.join(workingDirectory, args.join(' '));
                            const escapedPath = dirPath.replace(/'/g, "''");
                            exec(`powershell -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${escapedPath}', 'OnlyErrorDialogs', 'SendToRecycleBin')"`, (err) => {
                                if (err) {
                                    socket.emit('termOutput', `\x1b[31m✗ Failed to delete: ${args.join(' ')}\x1b[0m\r\n`);
                                } else {
                                    socket.emit('termOutput', `\x1b[32m✔ EXECUTED: ${cmd} (moved to Recycle Bin)\x1b[0m\r\n`);
                                }
                            });
                        } else if (command === '/cp') {
                            const source = path.join(workingDirectory, args[0]);
                            const dest = path.join(workingDirectory, args[1]);
                            fs.copyFileSync(source, dest);
                            socket.emit('termOutput', `\x1b[32m✔ EXECUTED: ${cmd}\x1b[0m\r\n`);
                        } else if (command === '/mv') {
                            const source = path.join(workingDirectory, args[0]);
                            const dest = path.join(workingDirectory, args[1]);
                            fs.renameSync(source, dest);
                            socket.emit('termOutput', `\x1b[32m✔ EXECUTED: ${cmd}\x1b[0m\r\n`);
                        } else {
                            socket.emit('termOutput', `\x1b[33m⚠ Unknown operation: ${cmd}\x1b[0m\r\n`);
                        }
                        opsCount++;
                    } catch (err) {
                        socket.emit('termOutput', `\x1b[31m✗ Error executing ${cmd}: ${err.message}\x1b[0m\r\n`);
                    }
                }
            }

            if (filesCount > 0 || opsCount > 0) {
                socket.emit('termOutput', `\r\n\x1b[32m✓ Completed: ${filesCount} file(s), ${opsCount} operation(s)\x1b[0m\r\n`);
            }
        } else {
            socket.emit('termOutput', `\r\n\x1b[33m✖ Cancelled. No actions performed.\x1b[0m\r\n`);
        }
        pendingFiles = [];
        socket.emit('termOutput', '$ ');
    });

    socket.on('command', async (cmd) => {
        // Handle slash commands
        if (cmd.startsWith('/')) {
            const parts = cmd.trim().split(' ');
            const command = parts[0].toLowerCase();
            const args = parts.slice(1);

            try {
                // /pwd - Show current directory
                if (command === '/pwd') {
                    socket.emit('termOutput', `\r\n${workingDirectory}\r\n`);
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /ls - List files in current directory
                if (command === '/ls' || command === '/files') {
                    const files = fs.readdirSync(workingDirectory);
                    socket.emit('termOutput', '\r\n\x1b[36m━━━ FILES IN ' + path.basename(workingDirectory) + ' ━━━\x1b[0m\r\n');
                    files.forEach(file => {
                        const stats = fs.statSync(path.join(workingDirectory, file));
                        const icon = stats.isDirectory() ? '📁' : '📄';
                        const color = stats.isDirectory() ? '\x1b[34m' : '\x1b[37m';
                        socket.emit('termOutput', `${icon} ${color}${file}\x1b[0m\r\n`);
                    });
                    socket.emit('termOutput', '\r\n');
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /cd - Change directory
                if (command === '/cd') {
                    if (args.length === 0) {
                        socket.emit('termOutput', '\r\n\x1b[33mUsage: /cd <directory>\x1b[0m\r\n');
                    } else {
                        const targetDir = args[0] === '..'
                            ? path.dirname(workingDirectory)
                            : path.resolve(workingDirectory, args.join(' '));

                        if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
                            workingDirectory = targetDir;
                            socket.emit('termOutput', `\r\n\x1b[32m✓ Changed to: ${workingDirectory}\x1b[0m\r\n`);
                        } else {
                            socket.emit('termOutput', '\r\n\x1b[31m✗ Directory not found\x1b[0m\r\n');
                        }
                    }
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /mkdir - Create directory
                if (command === '/mkdir') {
                    if (args.length === 0) {
                        socket.emit('termOutput', '\r\n\x1b[33mUsage: /mkdir <directory_name>\x1b[0m\r\n');
                    } else {
                        const newDir = path.join(workingDirectory, args.join(' '));
                        fs.mkdirSync(newDir, { recursive: true });
                        socket.emit('termOutput', `\r\n\x1b[32m✓ Created: ${args.join(' ')}\x1b[0m\r\n`);
                    }
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /cat - View file contents
                if (command === '/cat' || command === '/view') {
                    if (args.length === 0) {
                        socket.emit('termOutput', '\r\n\x1b[33mUsage: /cat <filename>\x1b[0m\r\n');
                    } else {
                        const filePath = path.join(workingDirectory, args.join(' '));
                        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                            const content = fs.readFileSync(filePath, 'utf-8');
                            socket.emit('termOutput', '\r\n\x1b[36m━━━ ' + args.join(' ') + ' ━━━\x1b[0m\r\n');
                            socket.emit('termOutput', '\x1b[37m' + content.replace(/\n/g, '\r\n') + '\x1b[0m\r\n');
                            socket.emit('termOutput', '\x1b[36m━━━━━━━━━━━━━━━━━━━━━\x1b[0m\r\n');
                        } else {
                            socket.emit('termOutput', '\r\n\x1b[31m✗ File not found\x1b[0m\r\n');
                        }
                    }
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /clear - Clear terminal screen
                if (command === '/clear' || command === '/cls') {
                    socket.emit('termOutput', '\x1bc'); // Clear screen escape code
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /touch - Create empty file
                if (command === '/touch') {
                    if (args.length === 0) {
                        socket.emit('termOutput', '\r\n\x1b[33mUsage: /touch <filename>\x1b[0m\r\n');
                    } else {
                        const filePath = path.join(workingDirectory, args.join(' '));
                        fs.writeFileSync(filePath, '');
                        socket.emit('termOutput', `\r\n\x1b[32m✓ Created: ${args.join(' ')}\x1b[0m\r\n`);
                    }
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /cp - Copy file
                if (command === '/cp' || command === '/copy') {
                    if (args.length < 2) {
                        socket.emit('termOutput', '\r\n\x1b[33mUsage: /cp <source> <destination>\x1b[0m\r\n');
                    } else {
                        const srcPath = path.join(workingDirectory, args[0]);
                        const destPath = path.join(workingDirectory, args[1]);
                        if (fs.existsSync(srcPath)) {
                            fs.copyFileSync(srcPath, destPath);
                            socket.emit('termOutput', `\r\n\x1b[32m✓ Copied: ${args[0]} → ${args[1]}\x1b[0m\r\n`);
                        } else {
                            socket.emit('termOutput', '\r\n\x1b[31m✗ Source file not found\x1b[0m\r\n');
                        }
                    }
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /mv - Move/rename file
                if (command === '/mv' || command === '/move' || command === '/rename') {
                    if (args.length < 2) {
                        socket.emit('termOutput', '\r\n\x1b[33mUsage: /mv <source> <destination>\x1b[0m\r\n');
                    } else {
                        const srcPath = path.join(workingDirectory, args[0]);
                        const destPath = path.join(workingDirectory, args[1]);
                        if (fs.existsSync(srcPath)) {
                            fs.renameSync(srcPath, destPath);
                            socket.emit('termOutput', `\r\n\x1b[32m✓ Moved: ${args[0]} → ${args[1]}\x1b[0m\r\n`);
                        } else {
                            socket.emit('termOutput', '\r\n\x1b[31m✗ Source file not found\x1b[0m\r\n');
                        }
                    }
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /find - Find files by pattern
                if (command === '/find' || command === '/search') {
                    if (args.length === 0) {
                        socket.emit('termOutput', '\r\n\x1b[33mUsage: /find <pattern>\x1b[0m\r\n');
                    } else {
                        const pattern = args.join(' ').toLowerCase();
                        const files = fs.readdirSync(workingDirectory);
                        const matches = files.filter(f => f.toLowerCase().includes(pattern));

                        socket.emit('termOutput', `\r\n\x1b[36m━━━ SEARCH RESULTS FOR "${pattern}" ━━━\x1b[0m\r\n`);
                        if (matches.length === 0) {
                            socket.emit('termOutput', '\x1b[2mNo matches found\x1b[0m\r\n');
                        } else {
                            matches.forEach(file => {
                                const stats = fs.statSync(path.join(workingDirectory, file));
                                const icon = stats.isDirectory() ? '📁' : '📄';
                                socket.emit('termOutput', `${icon} ${file}\r\n`);
                            });
                        }
                        socket.emit('termOutput', '\r\n');
                    }
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /echo - Print text
                if (command === '/echo') {
                    socket.emit('termOutput', '\r\n' + args.join(' ') + '\r\n');
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /tree - Show directory tree
                if (command === '/tree') {
                    function showTree(dir, prefix = '') {
                        const files = fs.readdirSync(dir);
                        files.forEach((file, index) => {
                            const isLast = index === files.length - 1;
                            const stats = fs.statSync(path.join(dir, file));
                            const icon = stats.isDirectory() ? '📁' : '📄';
                            const branch = isLast ? '└── ' : '├── ';

                            socket.emit('termOutput', `${prefix}${branch}${icon} ${file}\r\n`);

                            if (stats.isDirectory() && file !== 'node_modules' && file !== '.git') {
                                const newPrefix = prefix + (isLast ? '    ' : '│   ');
                                showTree(path.join(dir, file), newPrefix);
                            }
                        });
                    }

                    socket.emit('termOutput', '\r\n\x1b[36m━━━ DIRECTORY TREE ━━━\x1b[0m\r\n');
                    socket.emit('termOutput', `📁 ${path.basename(workingDirectory)}\r\n`);
                    showTree(workingDirectory);
                    socket.emit('termOutput', '\r\n');
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /rm - Move to Recycle Bin (Windows safe delete)
                if (command === '/rm' || command === '/del') {
                    if (args.length === 0) {
                        socket.emit('termOutput', '\r\n\x1b[33mUsage: /rm <filename>\x1b[0m\r\n');
                    } else {
                        const filePath = path.join(workingDirectory, args.join(' '));
                        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                            // Move to Recycle Bin using PowerShell
                            const escapedPath = filePath.replace(/'/g, "''");
                            exec(`powershell -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escapedPath}', 'OnlyErrorDialogs', 'SendToRecycleBin')"`, (error) => {
                                if (error) {
                                    socket.emit('termOutput', `\r\n\x1b[31m✗ Error moving to Recycle Bin: ${error.message}\x1b[0m\r\n`);
                                } else {
                                    socket.emit('termOutput', `\r\n\x1b[32m✓ Moved to Recycle Bin: ${args.join(' ')}\x1b[0m\r\n`);
                                }
                                socket.emit('termOutput', '$ ');
                            });
                            return;
                        } else {
                            socket.emit('termOutput', '\r\n\x1b[31m✗ File not found\x1b[0m\r\n');
                        }
                    }
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /rmdir - Move directory to Recycle Bin
                if (command === '/rmdir') {
                    if (args.length === 0) {
                        socket.emit('termOutput', '\r\n\x1b[33mUsage: /rmdir <directory>\x1b[0m\r\n');
                    } else {
                        const dirPath = path.join(workingDirectory, args.join(' '));
                        if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
                            // Move to Recycle Bin using PowerShell
                            const escapedPath = dirPath.replace(/'/g, "''");
                            exec(`powershell -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${escapedPath}', 'OnlyErrorDialogs', 'SendToRecycleBin')"`, (error) => {
                                if (error) {
                                    socket.emit('termOutput', `\r\n\x1b[31m✗ Error moving to Recycle Bin: ${error.message}\x1b[0m\r\n`);
                                } else {
                                    socket.emit('termOutput', `\r\n\x1b[32m✓ Moved to Recycle Bin: ${args.join(' ')}\x1b[0m\r\n`);
                                }
                                socket.emit('termOutput', '$ ');
                            });
                            return;
                        } else {
                            socket.emit('termOutput', '\r\n\x1b[31m✗ Directory not found\x1b[0m\r\n');
                        }
                    }
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // /help - Show available commands
                if (command === '/help' || command === '/?') {
                    socket.emit('termOutput', '\r\n\x1b[36m━━━ AVAILABLE COMMANDS ━━━\x1b[0m\r\n');
                    socket.emit('termOutput', '\r\n\x1b[33mNavigation:\x1b[0m\r\n');
                    socket.emit('termOutput', '  \x1b[32m/pwd\x1b[0m              Show current directory\r\n');
                    socket.emit('termOutput', '  \x1b[32m/ls\x1b[0m               List files and folders\r\n');
                    socket.emit('termOutput', '  \x1b[32m/cd <dir>\x1b[0m         Change directory\r\n');
                    socket.emit('termOutput', '  \x1b[32m/tree\x1b[0m             Show directory tree\r\n');
                    socket.emit('termOutput', '\r\n\x1b[33mFile Operations:\x1b[0m\r\n');
                    socket.emit('termOutput', '  \x1b[32m/cat <file>\x1b[0m       View file contents\r\n');
                    socket.emit('termOutput', '  \x1b[32m/touch <file>\x1b[0m     Create empty file\r\n');
                    socket.emit('termOutput', '  \x1b[32m/cp <src> <dst>\x1b[0m   Copy file\r\n');
                    socket.emit('termOutput', '  \x1b[32m/mv <src> <dst>\x1b[0m   Move/rename file\r\n');
                    socket.emit('termOutput', '  \x1b[32m/rm <file>\x1b[0m        Delete file\r\n');
                    socket.emit('termOutput', '\r\n\x1b[33mDirectory Operations:\x1b[0m\r\n');
                    socket.emit('termOutput', '  \x1b[32m/mkdir <name>\x1b[0m     Create directory\r\n');
                    socket.emit('termOutput', '  \x1b[32m/rmdir <dir>\x1b[0m      Delete directory\r\n');
                    socket.emit('termOutput', '\r\n\x1b[33mUtility:\x1b[0m\r\n');
                    socket.emit('termOutput', '  \x1b[32m/find <pattern>\x1b[0m   Search for files\r\n');
                    socket.emit('termOutput', '  \x1b[32m/echo <text>\x1b[0m      Print text\r\n');
                    socket.emit('termOutput', '  \x1b[32m/clear\x1b[0m            Clear screen\r\n');
                    socket.emit('termOutput', '  \x1b[32m/help\x1b[0m             Show this help\r\n');
                    socket.emit('termOutput', '\r\n');
                    socket.emit('termOutput', '$ ');
                    return;
                }

                // Unknown command
                socket.emit('termOutput', `\r\n\x1b[33mUnknown command: ${command}\x1b[0m\r\n`);
                socket.emit('termOutput', '\x1b[2mType /help for available commands\x1b[0m\r\n');
                socket.emit('termOutput', '$ ');
                return;

            } catch (e) {
                socket.emit('termOutput', `\r\n\x1b[31mError: ${e.message}\x1b[0m\r\n`);
                socket.emit('termOutput', '$ ');
                return;
            }
        }

        const promptToUse = currentMode === 'agent' ? AGENT_PROMPT : CHAT_PROMPT;
        const modelToUse = currentMode === 'agent' ? AGENT_MODEL : CHAT_MODEL;

        // Visual indicator that it is thinking
        socket.emit('termOutput', '\r\n\x1b[2m(Thinking...)\x1b[0m\r\n');

        try {
            const response = await axios.post(PI_API, {
                model: modelToUse,
                prompt: promptToUse + "\nUser: " + cmd + "\nAssistant:",
                stream: false,
                options: {
                    stop: ["User:", "Assistant:", "System:", "---"],
                    num_thread: CPU_THREADS  // Limit CPU usage
                }
	    });

            let aiText = response.data.response;

            // --- EXTRACT THINKING (for reasoning models like DeepSeek R1) ---
            const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
            let thinkMatch;
            let hasThinking = false;

            while ((thinkMatch = thinkRegex.exec(aiText)) !== null) {
                hasThinking = true;
                const thinking = thinkMatch[1].trim();
                // Display thinking in gray italic
                socket.emit('termOutput', '\x1b[2m\x1b[3m━━━ REASONING ━━━\x1b[0m\r\n');
                socket.emit('termOutput', '\x1b[2m' + thinking.replace(/\n/g, '\r\n') + '\x1b[0m\r\n');
                socket.emit('termOutput', '\x1b[2m\x1b[3m━━━━━━━━━━━━━━━━━\x1b[0m\r\n\r\n');
            }

            // Remove thinking tags from output
            aiText = aiText.replace(thinkRegex, '');

            // --- AGENT MODE: File & Operation Logic with Approval ---
            if (currentMode === 'agent') {
                const fileRegex = /<<<FILE: (.*?)>>>([\s\S]*?)<<<END>>>/g;
                const operationRegex = /<<<OPERATION: (.*?)>>>/g;
                let files = [];
                let operations = [];
                let match;

                // Extract files
                while ((match = fileRegex.exec(aiText)) !== null) {
                    files.push({
                        type: 'file',
                        name: match[1].trim(),
                        content: match[2].trim()
                    });
                }

                // Extract operations
                while ((match = operationRegex.exec(aiText)) !== null) {
                    operations.push({
                        type: 'operation',
                        command: match[1].trim()
                    });
                }

                const totalActions = files.length + operations.length;

                if (totalActions > 0) {
                    // Show the response without file/operation blocks
                    let cleanText = aiText.replace(fileRegex, '').replace(operationRegex, '');
                    if (cleanText.trim()) {
                        socket.emit('termOutput', cleanText.replace(/\n/g, '\r\n') + '\r\n\r\n');
                    }

                    // Notify user in terminal
                    socket.emit('termOutput', `\x1b[33m━━━ ACTIONS DETECTED ━━━\x1b[0m\r\n`);
                    socket.emit('termOutput', `\x1b[2mApproval popup opened. Press [1] to approve or [2] to reject.\x1b[0m\r\n\r\n`);

                    // Combine and store pending actions
                    pendingFiles = [...operations, ...files];
                    socket.emit('approvalRequest', { files: pendingFiles });
                    return; // Don't show $ yet
                } else {
                    // No actions, just show response
                    socket.emit('termOutput', aiText.replace(/\n/g, '\r\n') + '\r\n');
                }
            }
            // --- CHAT MODE: Pure Text ---
            else {
                socket.emit('termOutput', aiText.replace(/\n/g, '\r\n') + '\r\n');
            }

        } catch (e) {
            socket.emit('termOutput', `\r\n\x1b[31mError connecting to Pi: ${e.message}\x1b[0m\r\n`);
        }

        socket.emit('termOutput', '$ ');
    });
});

server.listen(3000, () => {
    console.log('Dual-Terminal running at http://localhost:3000');
});
