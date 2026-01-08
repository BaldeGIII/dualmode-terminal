// Storage Module - LocalStorage Management

const STORAGE_KEY = 'dualmode_terminal_data';

function generateChatId() {
    return 'chat-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function loadFromStorage() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : { chats: {}, currentChatId: null, currentMode: 'chat' };
    } catch (e) {
        console.error('Error loading from storage:', e);
        return { chats: {}, currentChatId: null, currentMode: 'chat' };
    }
}

function saveToStorage(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error('Error saving to storage:', e);
    }
}

function saveCurrentChat(currentChatId, mode, terminalHistory, chatMessages) {
    const data = loadFromStorage();

    if (!currentChatId) {
        currentChatId = generateChatId();
    }

    // Get all messages from the chat
    const messages = [];
    document.querySelectorAll('.chat-message').forEach(msg => {
        const sender = msg.classList.contains('user') ? 'user' : 'assistant';
        const bubble = msg.querySelector('.message-bubble');
        const text = bubble ? bubble.textContent : '';
        messages.push({ sender, text, timestamp: Date.now() });
    });

    data.chats[currentChatId] = {
        id: currentChatId,
        createdAt: data.chats[currentChatId]?.createdAt || Date.now(),
        messages: messages,
        mode: mode,
        terminalHistory: terminalHistory
    };
    data.currentChatId = currentChatId;
    data.currentMode = mode;

    saveToStorage(data);

    return currentChatId;
}

function loadCurrentChat(currentChatId) {
    const data = loadFromStorage();

    if (!data.currentChatId || !data.chats[data.currentChatId]) {
        return {
            chatId: generateChatId(),
            terminalHistory: [],
            mode: 'chat',
            messages: []
        };
    }

    const chat = data.chats[data.currentChatId];

    return {
        chatId: data.currentChatId,
        terminalHistory: chat.terminalHistory || [],
        mode: chat.mode || 'chat',
        messages: chat.messages || []
    };
}

function deleteChatFromStorage(chatId) {
    const data = loadFromStorage();
    delete data.chats[chatId];

    // If deleting current chat, find another one or create new
    if (chatId === data.currentChatId) {
        const remainingChats = Object.keys(data.chats);
        if (remainingChats.length > 0) {
            data.currentChatId = remainingChats[0];
            return { chatId: data.currentChatId, chat: data.chats[data.currentChatId] };
        } else {
            data.currentChatId = generateChatId();
            return { chatId: data.currentChatId, chat: null };
        }
    }

    saveToStorage(data);
    return null;
}

function getAllChats() {
    const data = loadFromStorage();
    return Object.values(data.chats).sort((a, b) => b.createdAt - a.createdAt);
}

function getChat(chatId) {
    const data = loadFromStorage();
    return data.chats[chatId];
}

function setCurrentChat(chatId) {
    const data = loadFromStorage();
    data.currentChatId = chatId;
    saveToStorage(data);
}
