// Terminal Module

function initializeTerminal() {
    const term = new Terminal({
        theme: { background: '#000', foreground: '#0f0', cursor: '#0f0' },
        fontSize: 14,
        cursorBlink: true,
        fontFamily: 'Consolas, monospace',
        convertEol: true,
        scrollback: 10000,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    const terminalContainer = document.getElementById('terminal-container');
    term.open(terminalContainer);

    // Ensure terminal fills container
    setTimeout(() => {
        fitAddon.fit();
    }, 100);

    window.addEventListener('resize', () => {
        fitAddon.fit();
    });

    term.write('\x1b[34mSystem Online. Initializing Display...\x1b[0m\r\n');
    term.write('Viewport calibrated. Waiting for input...\r\n$ ');

    return { term, fitAddon };
}

function setupTerminalHandlers(term, socket, terminalHistory) {
    let currentLine = '';
    let lastCommand = '';

    term.onData(e => {
        if (e === '\r') {
            term.write('\r\n');
            lastCommand = currentLine;

            // Store command in history
            if (currentLine.trim()) {
                terminalHistory.push({
                    type: 'command',
                    text: currentLine,
                    timestamp: Date.now()
                });
            }

            socket.emit('command', currentLine);
            currentLine = '';
        } else if (e === '\u007F') {
            if (currentLine.length > 0) {
                currentLine = currentLine.slice(0, -1);
                term.write('\b \b');
            }
        } else {
            currentLine += e;
            term.write(e);
        }
    });

    socket.on('termOutput', (data) => {
        term.write(data);

        // Store output in history (clean ANSI codes for storage)
        const cleanData = data.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n').trim();
        if (cleanData && cleanData !== '$') {
            terminalHistory.push({
                type: 'output',
                text: cleanData,
                timestamp: Date.now()
            });
        }

        // Keep history limited to last 100 entries
        if (terminalHistory.length > 100) {
            terminalHistory.splice(0, terminalHistory.length - 100);
        }
    });
}
