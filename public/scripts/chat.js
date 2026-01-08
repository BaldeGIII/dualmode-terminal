// Chat Module

function addMessage(text, sender, imageInfo = null, shouldSave = true, mode, terminalHistory, currentChatId, updateCallback) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;

    const header = document.createElement('div');
    header.className = 'message-header';
    header.textContent = sender === 'user' ? '> USER' : '> ASSISTANT';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (imageInfo) {
        const fileInfo = document.createElement('div');
        fileInfo.style.color = '#888';
        fileInfo.style.fontSize = '12px';
        fileInfo.style.marginBottom = '8px';
        fileInfo.style.padding = '6px 10px';
        fileInfo.style.background = '#0a0a0a';
        fileInfo.style.borderRadius = '4px';
        fileInfo.style.border = '1px solid #333';
        fileInfo.textContent = `📷 ${imageInfo.name} - ${imageInfo.type}`;
        bubble.appendChild(fileInfo);
    }

    const textContent = document.createElement('div');

    // Render markdown for assistant messages
    if (sender === 'assistant') {
        textContent.innerHTML = renderMarkdown(text);
        // Add copy buttons to code blocks after rendering
        setTimeout(() => addCopyButtons(textContent), 0);
    } else {
        textContent.textContent = text;
    }

    bubble.appendChild(textContent);

    messageDiv.appendChild(header);
    messageDiv.appendChild(bubble);

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Auto-save to localStorage
    if (shouldSave && updateCallback) {
        updateCallback();
    }
}

function addThinkingIndicator(withImage = false) {
    const chatMessages = document.getElementById('chat-messages');
    const indicator = document.createElement('div');
    indicator.className = 'thinking-indicator';
    indicator.id = 'thinking';

    if (withImage) {
        indicator.innerHTML = '▓ Processing image (may take 1-5 minutes)...<br><span style="font-size: 12px; color: #666;">Type /cancel to stop</span>';
    } else {
        indicator.textContent = '▓ Processing...';
    }

    chatMessages.appendChild(indicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeThinkingIndicator() {
    const indicator = document.getElementById('thinking');
    if (indicator) indicator.remove();
}

function clearImage() {
    const imagePreview = document.getElementById('image-preview');
    const imagePreviewContainer = document.getElementById('image-preview-container');
    const fileInput = document.getElementById('file-input');

    imagePreview.src = '';
    imagePreviewContainer.classList.remove('active');
    fileInput.value = '';
}
