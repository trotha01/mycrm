export function formatDate(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const diffTime = Math.abs(today - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) return 'Yesterday';
    if (diffDays <= 7) return `${diffDays} days ago`;
    if (diffDays <= 30) return `${Math.ceil(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
}

export function createElement(tag, options = {}) {
    const element = document.createElement(tag);
    if (options.className) {
        element.className = options.className;
    }
    if (options.text) {
        element.textContent = options.text;
    }
    if (options.html) {
        element.innerHTML = options.html;
    }
    if (options.attributes) {
        Object.entries(options.attributes).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                element.setAttribute(key, value);
            }
        });
    }
    return element;
}

export function clearChildren(element) {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}
