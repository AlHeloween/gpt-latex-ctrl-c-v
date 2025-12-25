/**
 * Test helper script for extension testing.
 * This script is injected into the page to help with automated testing.
 */

(function() {
    'use strict';
    
    // Expose a test API to the window object
    window.extensionTestHelper = {
        /**
         * Trigger the extension's copy function by simulating the message
         * that background.js would send.
         */
        async triggerCopy() {
            // Since content scripts run in isolated context, we need to
            // use a different approach. We'll use window.postMessage
            // and have the content script listen for it in test mode.
            
            // For testing, we'll dispatch a custom event that the content
            // script can listen to (if modified to support test mode)
            window.dispatchEvent(new CustomEvent('extension-test-copy', {
                detail: { type: 'COPY_OFFICE_FORMAT' }
            }));
            
            // Also try to access browser.runtime if available
            if (typeof browser !== 'undefined' && browser.runtime) {
                try {
                    await browser.runtime.sendMessage({type: 'COPY_OFFICE_FORMAT'});
                } catch (e) {
                    console.warn('Could not send message via browser.runtime:', e);
                }
            }
            
            return true;
        },
        
        /**
         * Get the current selection as HTML and text.
         */
        getSelection() {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) {
                return { html: '', text: '' };
            }
            
            const range = sel.getRangeAt(0).cloneRange();
            const div = document.createElement('div');
            div.appendChild(range.cloneContents());
            
            return {
                html: div.innerHTML,
                text: sel.toString()
            };
        },
        
        /**
         * Select text within an element.
         */
        selectElement(selector) {
            const element = document.querySelector(selector);
            if (!element) {
                throw new Error(`Element not found: ${selector}`);
            }
            
            const range = document.createRange();
            range.selectNodeContents(element);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            
            return this.getSelection();
        },
        
        /**
         * Wait for clipboard to be ready.
         */
        async waitForClipboard(timeout = 5000) {
            // Check if clipboard API is available
            if (!navigator.clipboard || !navigator.clipboard.read) {
                throw new Error('Clipboard API not available');
            }
            
            const startTime = Date.now();
            while (Date.now() - startTime < timeout) {
                try {
                    const items = await navigator.clipboard.read();
                    if (items.length > 0) {
                        return true;
                    }
                } catch (e) {
                    // Clipboard might not be ready yet
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            return false;
        }
    };
    
    console.log('Extension test helper loaded');
})();

