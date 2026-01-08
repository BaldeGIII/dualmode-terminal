// Sidebar Module

function formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
}

function getChatTitle(chat) {
    // Get first user message as title
    if (chat.messages && chat.messages.length > 0) {
        const firstUserMsg = chat.messages.find(m => m.sender === 'user');
        if (firstUserMsg) {
            return firstUserMsg.text.substring(0, 30) + (firstUserMsg.text.length > 30 ? '...' : '');
        }
    }
    return 'New Chat';
}

function renderChatsList(currentChatId, onSwitchChat, onDeleteChat) {
    const chatsList = document.getElementById('chats-list');
    chatsList.innerHTML = '';

    const chatsArray = getAllChats();

    chatsArray.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        if (chat.id === currentChatId) {
            chatItem.classList.add('active');
        }

        const content = document.createElement('div');
        content.className = 'chat-item-content';

        const title = document.createElement('div');
        title.className = 'chat-item-title';
        title.textContent = getChatTitle(chat);

        const date = document.createElement('div');
        date.className = 'chat-item-date';
        date.textContent = formatDate(chat.createdAt);

        content.appendChild(title);
        content.appendChild(date);

        // Add delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-chat-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Delete chat';
        deleteBtn.addEventListener('click', (e) => onDeleteChat(chat.id, e));

        chatItem.appendChild(content);
        chatItem.appendChild(deleteBtn);

        chatItem.addEventListener('click', () => onSwitchChat(chat.id));

        chatsList.appendChild(chatItem);
    });
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
}
