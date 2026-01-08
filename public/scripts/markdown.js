// Markdown Rendering Module

function renderMarkdown(text) {
    // Configure marked options
    marked.setOptions({
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
        breaks: true,
        gfm: true
    });

    return marked.parse(text);
}

function addCopyButtons(element) {
    const codeBlocks = element.querySelectorAll('pre code');
    codeBlocks.forEach((codeBlock, index) => {
        const pre = codeBlock.parentElement;

        // Get language from class (e.g., "language-python")
        const lang = codeBlock.className.match(/language-(\w+)/)?.[1] || 'text';

        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';

        // Create header
        const header = document.createElement('div');
        header.className = 'code-header';

        const langLabel = document.createElement('span');
        langLabel.className = 'code-language';
        langLabel.textContent = lang;

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-code-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(codeBlock.textContent).then(() => {
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = 'Copy';
                    copyBtn.classList.remove('copied');
                }, 2000);
            });
        };

        header.appendChild(langLabel);
        header.appendChild(copyBtn);

        // Wrap the pre element
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(header);
        wrapper.appendChild(pre);
    });
}
