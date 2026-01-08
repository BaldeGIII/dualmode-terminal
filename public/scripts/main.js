// Main Application Logic

const socket = io();
let mode = 'chat';
let currentImage = null;
let currentImageName = null;
let currentImageType = null;
let currentChatId = null;
let terminalHistory = [];
let term, fitAddon;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Initialize terminal
    const terminalSetup = initializeTerminal();
    term = terminalSetup.term;
    fitAddon = terminalSetup.fitAddon;

    // Setup terminal handlers
    setupTerminalHandlers(term, socket, terminalHistory);

    // Load saved chat
    const loadedChat = loadCurrentChat();
    currentChatId = loadedChat.chatId;
    terminalHistory = loadedChat.terminalHistory;
    mode = loadedChat.mode;

    // Restore mode UI
    if (mode === 'agent') {
        updateModeUI();
    }

    // Restore messages
    loadedChat.messages.forEach(msg => {
        addMessage(msg.text, msg.sender, null, false, mode, terminalHistory, currentChatId, updateChatCallback);
    });

    // Render chats list
    renderChatsList(currentChatId, switchToChat, handleDeleteChat);

    // Setup event listeners
    setupEventListeners();

    // Focus chat input
    document.getElementById('chat-input').focus();

    // Send model info to client
    socket.on('modelInfo', (data) => {
        const { chatModel, agentModel } = data;
        const chatName = chatModel.split(':')[0].toUpperCase();
        const agentName = agentModel.split(':')[0].toUpperCase();
        document.getElementById('label-chat').textContent = `CHAT (${chatName})`;
        document.getElementById('label-agent').textContent = `AGENT (${agentName})`;
    });

    // Handle chat response
    socket.on('chatResponse', (response) => {
        removeThinkingIndicator();
        addMessage(response, 'assistant', null, true, mode, terminalHistory, currentChatId, updateChatCallback);
    });

    // Handle approval requests
    socket.on('approvalRequest', (data) => {
        showApprovalPopup(data.files);
    });
});

function setupEventListeners() {
    // Chat input
    const chatInput = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');

    sendBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });

    // Image handling
    document.getElementById('attach-btn').addEventListener('click', () => {
        document.getElementById('file-input').click();
    });

    document.getElementById('file-input').addEventListener('change', handleFileSelect);
    document.getElementById('remove-image').addEventListener('click', clearImage);

    // Mode switching
    document.getElementById('mode-switch').addEventListener('click', handleModeSwitch);

    // Sidebar controls
    document.getElementById('new-chat-btn-sidebar').addEventListener('click', createNewChat);
    document.getElementById('hamburger-btn').addEventListener('click', toggleSidebar);

    // Approval modal
    document.getElementById('approve-btn').addEventListener('click', () => {
        document.getElementById('approval-modal').classList.remove('active');
        socket.emit('approvalResponse', { approved: true });
    });

    document.getElementById('reject-btn').addEventListener('click', () => {
        document.getElementById('approval-modal').classList.remove('active');
        socket.emit('approvalResponse', { approved: false });
    });

    // Keyboard shortcuts for approval
    document.addEventListener('keydown', (e) => {
        const approvalModal = document.getElementById('approval-modal');
        if (approvalModal.classList.contains('active')) {
            if (e.key === '1') {
                document.getElementById('approve-btn').click();
            } else if (e.key === '2') {
                document.getElementById('reject-btn').click();
            }
        }
    });
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    currentImageName = file.name;
    currentImageType = file.type.split('/')[1].toUpperCase();

    const reader = new FileReader();
    reader.onload = (event) => {
        currentImage = event.target.result;
        document.getElementById('image-preview').src = currentImage;
        document.getElementById('image-preview-container').classList.add('active');
    };
    reader.readAsDataURL(file);
}

function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    let text = chatInput.value.trim();
    if (!text && !currentImage) return;

    const hasImage = !!currentImage;
    let messageToSend = text;

    // Handle /context command
    if (text.startsWith('/context')) {
        const userQuery = text.replace('/context', '').trim();

        // Build terminal context
        const contextText = terminalHistory
            .slice(-20)
            .map(entry => {
                if (entry.type === 'command') {
                    return `$ ${entry.text}`;
                } else {
                    return entry.text;
                }
            })
            .join('\n');

        messageToSend = `Here is my recent terminal history for context:\n\n\`\`\`\n${contextText}\n\`\`\`\n\n${userQuery}`;
        addMessage(userQuery || 'Sharing terminal context...', 'user', null, true, mode, terminalHistory, currentChatId, updateChatCallback);
    } else {
        const imageInfo = currentImage ? { name: currentImageName, type: currentImageType } : null;
        addMessage(text || '[Image attachment]', 'user', imageInfo, true, mode, terminalHistory, currentChatId, updateChatCallback);
    }

    socket.emit('chatMessage', { text: messageToSend, image: currentImage, imageName: currentImageName });

    chatInput.value = '';
    clearImage();
    currentImage = null;
    currentImageName = null;
    currentImageType = null;

    addThinkingIndicator(hasImage);
}

function updateModeUI() {
    const btn = document.getElementById('mode-switch');
    const txtChat = document.getElementById('label-chat');
    const txtAgent = document.getElementById('label-agent');
    const chatContainer = document.getElementById('chat-container');
    const terminalContainer = document.getElementById('terminal-container');

    if (mode === 'agent') {
        btn.className = 'toggle-bg agent';
        txtChat.classList.remove('active');
        txtAgent.classList.add('active');
        txtAgent.style.color = '#d00';
        txtChat.style.color = '#555';
        term.options.theme = { foreground: '#ff4444', cursor: '#ff4444' };

        chatContainer.classList.remove('active');
        terminalContainer.style.display = 'block';

        setTimeout(() => {
            fitAddon.fit();
            term.focus();
        }, 50);
    } else {
        btn.className = 'toggle-bg chat';
        txtAgent.classList.remove('active');
        txtChat.classList.add('active');
        txtChat.style.color = '#007bff';
        txtAgent.style.color = '#555';
        term.options.theme = { foreground: '#0f0', cursor: '#0f0' };

        chatContainer.classList.add('active');
        terminalContainer.style.display = 'none';
        document.getElementById('chat-input').focus();
    }
    socket.emit('switchMode', mode);
}

function handleModeSwitch() {
    mode = mode === 'chat' ? 'agent' : 'chat';
    updateModeUI();
    updateChatCallback();
}

function createNewChat() {
    updateChatCallback();
    currentChatId = generateChatId();
    document.getElementById('chat-messages').innerHTML = '';
    terminalHistory = [];
    setCurrentChat(currentChatId);
    renderChatsList(currentChatId, switchToChat, handleDeleteChat);
}

async function handleDeleteChat(chatId, event) {
    event.stopPropagation();

    const confirmed = await showConfirm(
        '🗑 Delete Chat',
        'Are you sure you want to delete this chat? This cannot be undone.'
    );

    if (!confirmed) return;

    const result = deleteChatFromStorage(chatId);

    if (result) {
        currentChatId = result.chatId;
        document.getElementById('chat-messages').innerHTML = '';

        if (result.chat) {
            terminalHistory = result.chat.terminalHistory || [];
            result.chat.messages.forEach(msg => {
                addMessage(msg.text, msg.sender, null, false, mode, terminalHistory, currentChatId, updateChatCallback);
            });
        } else {
            terminalHistory = [];
        }
    }

    renderChatsList(currentChatId, switchToChat, handleDeleteChat);
}

function switchToChat(chatId) {
    updateChatCallback();

    const chat = getChat(chatId);
    if (!chat) return;

    currentChatId = chatId;
    setCurrentChat(chatId);

    document.getElementById('chat-messages').innerHTML = '';
    terminalHistory = chat.terminalHistory || [];

    if (chat.mode && chat.mode !== mode) {
        mode = chat.mode;
        updateModeUI();
    }

    chat.messages.forEach(msg => {
        addMessage(msg.text, msg.sender, null, false, mode, terminalHistory, currentChatId, updateChatCallback);
    });

    renderChatsList(currentChatId, switchToChat, handleDeleteChat);
}

function updateChatCallback() {
    currentChatId = saveCurrentChat(currentChatId, mode, terminalHistory, document.getElementById('chat-messages'));
    renderChatsList(currentChatId, switchToChat, handleDeleteChat);
}

function showApprovalPopup(files) {
    const approvalFilesList = document.getElementById('approval-files-list');
    approvalFilesList.innerHTML = '';

    files.forEach(item => {
        const actionItem = document.createElement('div');
        actionItem.className = 'file-item';

        if (item.type === 'file') {
            const fileHeader = document.createElement('div');
            fileHeader.className = 'file-header';
            fileHeader.innerHTML = `
                <span>📄 ${item.name}</span>
                <span class="file-lines">${item.content.split('\n').length} lines</span>
            `;

            const filePreview = document.createElement('div');
            filePreview.className = 'file-preview';
            filePreview.textContent = item.content;

            actionItem.appendChild(fileHeader);
            actionItem.appendChild(filePreview);
        } else if (item.type === 'operation') {
            const opHeader = document.createElement('div');
            opHeader.className = 'file-header';
            opHeader.innerHTML = `
                <span>⚙️ ${item.command}</span>
                <span class="file-lines" style="color: #f90;">OPERATION</span>
            `;

            const opDescription = document.createElement('div');
            opDescription.className = 'file-preview';
            opDescription.style.color = '#0f0';
            opDescription.style.fontFamily = 'Consolas, monospace';
            opDescription.textContent = `Will execute: ${item.command}`;

            actionItem.appendChild(opHeader);
            actionItem.appendChild(opDescription);
        }

        approvalFilesList.appendChild(actionItem);
    });

    document.getElementById('approval-modal').classList.add('active');
}
