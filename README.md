# DualMode Terminal

A dual-mode AI terminal application combining conversational chat with an autonomous agent capable of file system operations, featuring a complete approval system for safe AI-driven development.

## Features

- **Dual Interface**: Switch between chat mode (conversational bubbles) and agent mode (terminal emulation)
- **Collapsible Sidebar**: Claude-style sidebar to manage multiple chat sessions
- **Chat Persistence**: All conversations saved to localStorage and restored on page refresh
- **AI-Powered**: Uses Ollama models (Gemma 3 4B for chat, DeepSeek R1 7B for agent)
- **Multimodal Support**: Upload and analyze images with vision models
- **Autonomous Agent**: AI can create files, manage directories, and perform operations
- **Approval System**: All agent actions require explicit user approval (keyboard shortcuts: 1=approve, 2=reject)
- **Safe Operations**: File deletions go to Recycle Bin instead of permanent deletion
- **Full Terminal Commands**: ls, cd, mkdir, cat, rm, rmdir, cp, mv, touch, find, tree, echo, clear, help
- **CPU Optimization**: Configurable CPU thread limiting (default: 75% on 4-core systems)
- **Real-time Communication**: Built with Socket.IO for instant updates

## Prerequisites

- [Node.js](https://nodejs.org/) (v14 or higher)
- [Ollama](https://ollama.ai/) with models:
  - `gemma3:4b` (for chat mode)
  - `deepseek-r1:7b` (for agent mode)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/dualmode-terminal.git
cd dualmode-terminal
```

2. Install dependencies:
```bash
npm install
```

3. **SSH Tunnel to Raspberry Pi**:
```bash
ssh -L 11434:localhost:11434 <username>@<ip>
```
This creates an SSH tunnel that forwards port 11434 from your Pi to your local machine, allowing the application to communicate with Ollama running on the Pi. Make sure Ollama is running on your Pi with the required models (`gemma3:4b` and `deepseek-r1:7b`).

4. Start the server:
```bash
node server.js
```

5. Open your browser to `http://localhost:3000`

## Usage

### Chat Mode
- Type messages naturally to have conversations with the AI
- Upload images using the 📎 button for multimodal analysis
- Get helpful responses without file system access

### Agent Mode
- Toggle to Agent mode using the switch at the top
- AI can autonomously create files and perform operations
- Use terminal commands like `/ls`, `/cd`, `/mkdir`, etc.
- All actions require approval before execution

### Available Commands
```
/pwd            - Show current directory
/ls             - List files in current directory
/cd <dir>       - Change directory
/mkdir <name>   - Create directory
/cat <file>     - View file contents
/touch <file>   - Create empty file
/rm <file>      - Delete file (to Recycle Bin)
/rmdir <dir>    - Delete directory (to Recycle Bin)
/cp <src> <dst> - Copy file
/mv <src> <dst> - Move/rename file
/find <pattern> - Search for files
/echo <text>    - Display text
/tree           - Show directory tree
/clear          - Clear terminal screen
/help           - Show available commands
```

## Configuration

Edit `server.js` to customize:

```javascript
const CHAT_MODEL = 'gemma3:4b';      // Change chat model
const AGENT_MODEL = 'deepseek-r1:7b'; // Change agent model
const CPU_THREADS = 3;                // CPU usage (3/4 cores = 75%)
```

## Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Terminal**: xterm.js with FitAddon
- **AI**: Ollama API (local LLM inference)
- **File Operations**: Node.js fs module with PowerShell integration

## How It Works

1. **Agent creates files/operations** using special syntax (`<<<FILE:>>>` or `<<<OPERATION:>>>`)
2. **Server parses** the AI response and extracts pending actions
3. **Approval popup** displays all files and operations
4. **User approves/rejects** using keyboard shortcuts (1 or 2)
5. **Server executes** approved actions and provides feedback

## Safety Features

- All agent actions require explicit approval
- File deletions use Windows Recycle Bin (recoverable)
- CPU usage limiting to prevent system overload
- Error handling for invalid operations
- Clear visual feedback for all actions

## Contributing

Pull requests welcome! For major changes, please open an issue first to discuss proposed changes.

## License

MIT

## Acknowledgments

- Built for Raspberry Pi 5
- Uses Ollama for local AI inference
- Terminal emulation powered by xterm.js
