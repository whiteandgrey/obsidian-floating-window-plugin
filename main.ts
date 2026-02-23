import { Notice, Plugin, Menu, Editor, Command, WorkspaceLeaf, PluginSettingTab, Setting, MarkdownRenderer } from 'obsidian';

interface FloatingWindow {
  id: string;
  element: HTMLElement;
  contentElement: HTMLElement;
  closeButton: HTMLElement;
  locationButton: HTMLElement;
  isDragging: boolean;
  dragStart: { x: number; y: number };
  isResizing: boolean;
  resizeStart: { x: number; y: number; width: number; height: number };
  originalText: string;
  originalSelection: DOMRect | null;
  sourceLeaf: WorkspaceLeaf | null;
  eventListeners: {
    dragMouseDown: (e: MouseEvent) => void;
    dragMouseMove: (e: MouseEvent) => void;
    dragMouseUp: () => void;
    resizeMouseMove: (e: MouseEvent) => void;
    resizeMouseDown: (e: MouseEvent) => void;
    resizeDocMouseMove: (e: MouseEvent) => void;
    resizeDocMouseUp: () => void;
    resizeMouseLeave: () => void;
  } | null;
}

interface PluginSettings {
  showCloseButton: boolean;
  enableSmoothTransitions: boolean;
  hotkey: string;
  language: 'zh' | 'en';
  maxWindowWidth: number;
  maxWindowHeight: number;
}

const DEFAULT_SETTINGS: PluginSettings = {
  showCloseButton: true,
  enableSmoothTransitions: true,
  hotkey: 'Alt+w',
  language: 'zh',
  maxWindowWidth: 800,
  maxWindowHeight: 600
};

export default class FloatingWindowPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  floatingWindows: FloatingWindow[] = [];
  nextWindowId: number = 1;

  async onload() {
    await this.loadSettings();
    this.floatingWindows = [];
    this.nextWindowId = 1;

    // Register command
    this.addCommand({
      id: 'open-floating-window',
      name: 'Open selected text in floating window',
      callback: () => this.openFloatingWindowForSelection(),
      hotkeys: [{ modifiers: ['Alt'], key: 'w' }]
    });

    // Register context menu (using type assertion to bypass TypeScript type checking)
    this.registerEvent(
      (this.app.workspace as any).on('editor-menu', (menu: Menu, editor: Editor, view: WorkspaceLeaf) => {
        const selectedText = editor.getSelection();
        if (selectedText.trim()) {
          // Get selection position
          const selection = window.getSelection();
          let selectionRect: DOMRect | null = null;
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            selectionRect = range.getBoundingClientRect();
          }
          
          menu.addItem((item) => {
            item.setTitle('Open in floating window')
              .setIcon('window')
              .onClick(async () => {
                await this.openFloatingWindow(selectedText, selectionRect, view);
              });
          });
        }
      })
    );

    // Register setting tab
    this.addSettingTab(new FloatingWindowSettingTab(this.app, this));

    // Register event to close floating windows when leaves are closed
    // Use layout-change event which fires when workspace layout changes (including leaf close)
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.cleanupOrphanedWindows();
      })
    );

    // Also check on active-leaf-change as backup
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.cleanupOrphanedWindows();
      })
    );

    console.log('Floating Window Plugin loaded');
  }

  async onunload() {
    // Clean up all floating windows
    this.floatingWindows.forEach(window => {
      window.element.remove();
    });
    this.floatingWindows = [];
    console.log('Floating Window Plugin unloaded');
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async openFloatingWindowForSelection() {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf && activeLeaf.view && 'editor' in activeLeaf.view) {
      const editor = activeLeaf.view.editor as Editor;
      if (editor) {
        const selectedText = editor.getSelection();
        if (selectedText.trim()) {
          // Get selection position
          const selection = window.getSelection();
          let selectionRect: DOMRect | null = null;
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            selectionRect = range.getBoundingClientRect();
          }
          await this.openFloatingWindow(selectedText, selectionRect, activeLeaf);
        } else {
          new Notice('Please select some text first');
        }
      }
    }
  }

  async openFloatingWindow(text: string, selectionRect?: DOMRect | null, sourceLeaf?: WorkspaceLeaf | null) {
    const id = `floating-window-${this.nextWindowId++}`;
    
    // Create window element
    const windowElement = document.createElement('div');
    windowElement.id = id;
    windowElement.className = 'floating-window';
    windowElement.style.position = 'fixed';
    windowElement.style.zIndex = '10000';
    windowElement.style.overflow = 'hidden';
    windowElement.style.backgroundColor = 'var(--background-primary)';
    windowElement.style.border = '1px solid var(--border-color)';
    windowElement.style.borderRadius = '4px';
    windowElement.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    windowElement.style.padding = '16px';
    windowElement.style.width = 'auto';
    windowElement.style.minWidth = '300px';
    windowElement.style.maxWidth = `${this.settings.maxWindowWidth}px`;
    windowElement.style.height = 'auto';
    windowElement.style.minHeight = '100px';
    windowElement.style.maxHeight = `${this.settings.maxWindowHeight}px`;
    windowElement.style.overflow = 'auto';
    windowElement.style.color = 'var(--text-normal)';
    windowElement.style.fontFamily = 'var(--font-ui)';
    windowElement.style.fontSize = 'var(--font-ui-size)';
    windowElement.style.lineHeight = '1.6';

    // Set window position based on selection
    this.setWindowPosition(windowElement, selectionRect);


    // Create close button
    const closeButton = document.createElement('button');
    closeButton.className = 'floating-window-close';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '8px';
    closeButton.style.right = '8px';
    closeButton.style.width = '24px';
    closeButton.style.height = '24px';
    closeButton.style.border = 'none';
    closeButton.style.backgroundColor = 'var(--background-secondary)';
    closeButton.style.color = 'var(--text-muted)';
    closeButton.style.borderRadius = '4px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.fontSize = '14px';
    closeButton.style.lineHeight = '24px';
    closeButton.style.textAlign = 'center';
    closeButton.textContent = '×';
    closeButton.onmouseenter = () => {
      closeButton.style.backgroundColor = 'var(--background-modifier-hover)';
      closeButton.style.color = 'var(--text-normal)';
    };
    closeButton.onmouseleave = () => {
      closeButton.style.backgroundColor = 'var(--background-secondary)';
      closeButton.style.color = 'var(--text-muted)';
    };
    closeButton.onclick = () => this.closeFloatingWindow(id);
    
    if (this.settings.showCloseButton) {
      windowElement.appendChild(closeButton);
    }

    // Create location button (jump to original paragraph)
    const locationButton = document.createElement('button');
    locationButton.className = 'floating-window-location';
    locationButton.style.position = 'absolute';
    locationButton.style.top = '8px';
    locationButton.style.left = '8px';
    locationButton.style.width = '24px';
    locationButton.style.height = '24px';
    locationButton.style.border = 'none';
    locationButton.style.backgroundColor = 'var(--background-secondary)';
    locationButton.style.color = 'var(--text-muted)';
    locationButton.style.borderRadius = '4px';
    locationButton.style.cursor = 'pointer';
    locationButton.style.fontSize = '14px';
    locationButton.style.lineHeight = '24px';
    locationButton.style.textAlign = 'center';
    locationButton.textContent = '🔗';
    locationButton.style.fontWeight = 'bold';
    locationButton.onmouseenter = () => {
      locationButton.style.backgroundColor = 'var(--background-modifier-hover)';
      locationButton.style.color = 'var(--text-normal)';
    };
    locationButton.onmouseleave = () => {
      locationButton.style.backgroundColor = 'var(--background-secondary)';
      locationButton.style.color = 'var(--text-muted)';
    };
    
    // Location button click handler
    locationButton.onclick = () => {
      this.jumpToOriginalParagraph(text, selectionRect);
    };
    
    // Add hover tooltip to location button
    this.addButtonTooltip(locationButton);
    
    windowElement.appendChild(locationButton);

    // Create content element
    const contentElement = document.createElement('div');
    contentElement.className = 'floating-window-content';
    contentElement.style.marginTop = '20px';
    contentElement.style.color = 'var(--text-normal)';
    contentElement.style.fontFamily = 'var(--font-ui)';
    contentElement.style.fontSize = 'var(--font-ui-size)';
    contentElement.style.lineHeight = '1.6';
    contentElement.style.padding = '0';
    contentElement.style.width = '100%';
    contentElement.style.height = 'calc(100% - 20px)';
    contentElement.style.overflow = 'auto';
    
    // Render markdown content
    await this.renderMarkdown(contentElement, text);
    
    windowElement.appendChild(contentElement);
    document.body.appendChild(windowElement);

    // Calculate optimal window size based on content
    this.adjustWindowSize(windowElement, contentElement, text);

    // Create window object
    const window: FloatingWindow = {
      id,
      element: windowElement,
      contentElement,
      closeButton,
      locationButton,
      isDragging: false,
      dragStart: { x: 0, y: 0 },
      isResizing: false,
      resizeStart: { x: 0, y: 0, width: 0, height: 0 },
      originalText: text,
      originalSelection: selectionRect || null,
      sourceLeaf: sourceLeaf || null,
      eventListeners: null
    };

    // Add drag functionality
    this.setupDrag(window);
    
    // Add resize functionality
    this.setupResize(window);

    // Add to windows array
    this.floatingWindows.push(window);

    return window;
  }

  setupDrag(window: FloatingWindow) {
    const RESIZE_AREA = 8; // Match the resize area size
    
    const dragMouseDown = (e: MouseEvent) => {
      // Only start dragging if clicked on the window header area and not on resize edges
      if (e.target === window.element || e.target === window.closeButton) {
        // Check if mouse is in resize area
        const rect = window.element.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Check if mouse is near any edge
        const isNearLeft = x <= RESIZE_AREA;
        const isNearRight = x >= rect.width - RESIZE_AREA;
        const isNearTop = y <= RESIZE_AREA;
        const isNearBottom = y >= rect.height - RESIZE_AREA;
        
        // Only start dragging if not in resize area
        if (!isNearLeft && !isNearRight && !isNearTop && !isNearBottom) {
          window.isDragging = true;
          window.dragStart.x = x;
          window.dragStart.y = y;
          window.element.style.userSelect = 'none';
        }
      }
    };

    const dragMouseMove = (e: MouseEvent) => {
      if (window.isDragging) {
        const x = e.clientX - window.dragStart.x;
        const y = e.clientY - window.dragStart.y;
        window.element.style.left = `${x}px`;
        window.element.style.top = `${y}px`;
      }
    };

    const dragMouseUp = () => {
      if (window.isDragging) {
        window.isDragging = false;
        window.element.style.userSelect = '';
      }
    };

    window.element.addEventListener('mousedown', dragMouseDown);
    document.addEventListener('mousemove', dragMouseMove);
    document.addEventListener('mouseup', dragMouseUp);

    // Store event listeners for cleanup
    if (!window.eventListeners) {
      window.eventListeners = {
        dragMouseDown,
        dragMouseMove,
        dragMouseUp,
        resizeMouseMove: () => {},
        resizeMouseDown: () => {},
        resizeDocMouseMove: () => {},
        resizeDocMouseUp: () => {},
        resizeMouseLeave: () => {}
      };
    } else {
      window.eventListeners.dragMouseDown = dragMouseDown;
      window.eventListeners.dragMouseMove = dragMouseMove;
      window.eventListeners.dragMouseUp = dragMouseUp;
    }
  }

  setupResize(window: FloatingWindow) {
    const RESIZE_AREA = 8; // 8px resize detection area
    let resizeDirection = '';
    let resizeStart = {
      x: 0, y: 0,
      width: 0, height: 0,
      left: 0, top: 0
    };

    // Mouse move event for cursor change and resize detection
    const resizeMouseMove = (e: MouseEvent) => {
      if (window.isResizing) return;

      const rect = window.element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check if mouse is near any edge
      const isNearLeft = x <= RESIZE_AREA;
      const isNearRight = x >= rect.width - RESIZE_AREA;
      const isNearTop = y <= RESIZE_AREA;
      const isNearBottom = y >= rect.height - RESIZE_AREA;

      // Determine resize direction and cursor
      if (isNearLeft && isNearTop) {
        window.element.style.cursor = 'nwse-resize';
        resizeDirection = 'nw';
      } else if (isNearRight && isNearBottom) {
        window.element.style.cursor = 'nwse-resize';
        resizeDirection = 'se';
      } else if (isNearLeft && isNearBottom) {
        window.element.style.cursor = 'nesw-resize';
        resizeDirection = 'sw';
      } else if (isNearRight && isNearTop) {
        window.element.style.cursor = 'nesw-resize';
        resizeDirection = 'ne';
      } else if (isNearLeft || isNearRight) {
        window.element.style.cursor = 'ew-resize';
        resizeDirection = isNearLeft ? 'w' : 'e';
      } else if (isNearTop || isNearBottom) {
        window.element.style.cursor = 'ns-resize';
        resizeDirection = isNearTop ? 'n' : 's';
      } else {
        window.element.style.cursor = '';
        resizeDirection = '';
      }
    };

    // Reset cursor when mouse leaves window
    const resizeMouseLeave = () => {
      if (!window.isResizing) {
        window.element.style.cursor = '';
        resizeDirection = '';
      }
    };

    // Mouse down event to start resizing
    const resizeMouseDown = (e: MouseEvent) => {
      if (!resizeDirection) return;

      window.isResizing = true;
      const rect = window.element.getBoundingClientRect();
      resizeStart.x = e.clientX;
      resizeStart.y = e.clientY;
      resizeStart.width = rect.width;
      resizeStart.height = rect.height;
      resizeStart.left = rect.left;
      resizeStart.top = rect.top;
      window.element.style.userSelect = 'none';
      e.preventDefault();
    };

    // Mouse move event to perform resizing
    const resizeDocMouseMove = (e: MouseEvent) => {
      if (!window.isResizing) return;

      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;

      switch (resizeDirection) {
        case 'se': // Bottom right
          // Only adjust width and height, keep top and left fixed
          window.element.style.width = `${Math.max(200, resizeStart.width + deltaX)}px`;
          window.element.style.height = `${Math.max(100, resizeStart.height + deltaY)}px`;
          // Ensure top and left remain unchanged
          window.element.style.left = `${resizeStart.left}px`;
          window.element.style.top = `${resizeStart.top}px`;
          break;
          
        case 'nw': // Top left
          // Adjust width, height, left and top
          const newWidthNW = Math.max(200, resizeStart.width - deltaX);
          const newHeightNW = Math.max(100, resizeStart.height - deltaY);
          window.element.style.width = `${newWidthNW}px`;
          window.element.style.height = `${newHeightNW}px`;
          window.element.style.left = `${resizeStart.left + resizeStart.width - newWidthNW}px`;
          window.element.style.top = `${resizeStart.top + resizeStart.height - newHeightNW}px`;
          break;
          
        case 'sw': // Bottom left
          // Adjust width, height and left, keep top fixed
          const newWidthSW = Math.max(200, resizeStart.width - deltaX);
          window.element.style.width = `${newWidthSW}px`;
          window.element.style.height = `${Math.max(100, resizeStart.height + deltaY)}px`;
          window.element.style.left = `${resizeStart.left + resizeStart.width - newWidthSW}px`;
          // Ensure top remains unchanged
          window.element.style.top = `${resizeStart.top}px`;
          break;
          
        case 'ne': // Top right
          // Adjust width, height and top, keep left fixed
          window.element.style.width = `${Math.max(200, resizeStart.width + deltaX)}px`;
          const newHeightNE = Math.max(100, resizeStart.height - deltaY);
          window.element.style.height = `${newHeightNE}px`;
          window.element.style.top = `${resizeStart.top + resizeStart.height - newHeightNE}px`;
          // Ensure left remains unchanged
          window.element.style.left = `${resizeStart.left}px`;
          break;
          
        case 'e': // Right
          // Only adjust width, keep other edges fixed
          window.element.style.width = `${Math.max(200, resizeStart.width + deltaX)}px`;
          // Ensure other edges remain unchanged
          window.element.style.height = `${resizeStart.height}px`;
          window.element.style.left = `${resizeStart.left}px`;
          window.element.style.top = `${resizeStart.top}px`;
          break;
          
        case 'w': // Left
          // Adjust width and left, keep other edges fixed
          const newWidthW = Math.max(200, resizeStart.width - deltaX);
          window.element.style.width = `${newWidthW}px`;
          window.element.style.left = `${resizeStart.left + resizeStart.width - newWidthW}px`;
          // Ensure other edges remain unchanged
          window.element.style.height = `${resizeStart.height}px`;
          window.element.style.top = `${resizeStart.top}px`;
          break;
          
        case 's': // Bottom
          // Only adjust height, keep other edges fixed
          window.element.style.height = `${Math.max(100, resizeStart.height + deltaY)}px`;
          // Ensure other edges remain unchanged
          window.element.style.width = `${resizeStart.width}px`;
          window.element.style.left = `${resizeStart.left}px`;
          window.element.style.top = `${resizeStart.top}px`;
          break;
          
        case 'n': // Top
          // Adjust height and top, keep other edges fixed
          const newHeightN = Math.max(100, resizeStart.height - deltaY);
          window.element.style.height = `${newHeightN}px`;
          window.element.style.top = `${resizeStart.top + resizeStart.height - newHeightN}px`;
          // Ensure other edges remain unchanged
          window.element.style.width = `${resizeStart.width}px`;
          window.element.style.left = `${resizeStart.left}px`;
          break;
      }
    };

    // Mouse up event to stop resizing
    const resizeDocMouseUp = () => {
      if (window.isResizing) {
        window.isResizing = false;
        window.element.style.userSelect = '';
        window.element.style.cursor = '';
        resizeDirection = '';
      }
    };

    window.element.addEventListener('mousemove', resizeMouseMove);
    window.element.addEventListener('mouseleave', resizeMouseLeave);
    window.element.addEventListener('mousedown', resizeMouseDown);
    document.addEventListener('mousemove', resizeDocMouseMove);
    document.addEventListener('mouseup', resizeDocMouseUp);

    // Store event listeners for cleanup
    if (window.eventListeners) {
      window.eventListeners.resizeMouseMove = resizeMouseMove;
      window.eventListeners.resizeMouseDown = resizeMouseDown;
      window.eventListeners.resizeDocMouseMove = resizeDocMouseMove;
      window.eventListeners.resizeDocMouseUp = resizeDocMouseUp;
      window.eventListeners.resizeMouseLeave = resizeMouseLeave;
    }
  }

  closeFloatingWindow(id: string) {
    const index = this.floatingWindows.findIndex(window => window.id === id);
    if (index !== -1) {
      const window = this.floatingWindows[index];
      
      // Remove all event listeners to prevent memory leaks
      if (window.eventListeners) {
        window.element.removeEventListener('mousedown', window.eventListeners.dragMouseDown);
        document.removeEventListener('mousemove', window.eventListeners.dragMouseMove);
        document.removeEventListener('mouseup', window.eventListeners.dragMouseUp);
        window.element.removeEventListener('mousemove', window.eventListeners.resizeMouseMove);
        window.element.removeEventListener('mouseleave', window.eventListeners.resizeMouseLeave);
        window.element.removeEventListener('mousedown', window.eventListeners.resizeMouseDown);
        document.removeEventListener('mousemove', window.eventListeners.resizeDocMouseMove);
        document.removeEventListener('mouseup', window.eventListeners.resizeDocMouseUp);
      }
      
      // Remove DOM element
      window.element.remove();
      this.floatingWindows.splice(index, 1);
    }
  }

  cleanupOrphanedWindows() {
    // Get all open leaves using the correct API
    const openLeaves: WorkspaceLeaf[] = [];
    this.app.workspace.iterateRootLeaves((leaf) => {
      openLeaves.push(leaf);
    });
    
    // Also get leaves from all tabs
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!openLeaves.includes(leaf)) {
        openLeaves.push(leaf);
      }
    });
    
    // Find windows whose source leaf is no longer open
    const windowsToClose: FloatingWindow[] = [];
    
    for (const window of this.floatingWindows) {
      if (window.sourceLeaf) {
        // Check if the source leaf is still in the workspace
        // Use multiple checks for reliability
        const sourceLeaf = window.sourceLeaf;
        const leafStillOpen = openLeaves.some((leaf: WorkspaceLeaf) => {
          // Check by reference
          if (leaf === sourceLeaf) return true;
          // Check by view existence
          if (leaf.view && sourceLeaf.view && leaf.view === sourceLeaf.view) return true;
          return false;
        });
        
        // Also check if the leaf's view is still valid
        const leafViewValid = sourceLeaf.view && 
                              sourceLeaf.view.containerEl && 
                              document.body.contains(sourceLeaf.view.containerEl);
        
        if (!leafStillOpen || !leafViewValid) {
          windowsToClose.push(window);
        }
      }
    }
    
    // Close orphaned windows with proper cleanup
    for (const window of windowsToClose) {
      // Remove all event listeners to prevent memory leaks
      if (window.eventListeners) {
        window.element.removeEventListener('mousedown', window.eventListeners.dragMouseDown);
        document.removeEventListener('mousemove', window.eventListeners.dragMouseMove);
        document.removeEventListener('mouseup', window.eventListeners.dragMouseUp);
        window.element.removeEventListener('mousemove', window.eventListeners.resizeMouseMove);
        window.element.removeEventListener('mouseleave', window.eventListeners.resizeMouseLeave);
        window.element.removeEventListener('mousedown', window.eventListeners.resizeMouseDown);
        document.removeEventListener('mousemove', window.eventListeners.resizeDocMouseMove);
        document.removeEventListener('mouseup', window.eventListeners.resizeDocMouseUp);
      }
      
      // Remove DOM element
      window.element.remove();
      const index = this.floatingWindows.indexOf(window);
      if (index !== -1) {
        this.floatingWindows.splice(index, 1);
      }
    }
  }

  async renderMarkdown(element: HTMLElement, markdown: string) {
    try {
      // Clear existing content
      element.innerHTML = '';
      
      // Create a container with proper classes for theme support
      const contentContainer = document.createElement('div');
      contentContainer.className = 'markdown-preview-view';
      contentContainer.style.padding = '0';
      contentContainer.style.margin = '0';
      
      // Use Obsidian's built-in markdown renderer for full compatibility
      // This will render all markdown elements correctly including headings, code blocks, mathjax, etc.
      await MarkdownRenderer.renderMarkdown(markdown, contentContainer, '', this);
      
      // Append the rendered content
      element.appendChild(contentContainer);
      
    } catch (error) {
      console.error('Error rendering markdown:', error);
      // Fallback to basic rendering if Obsidian renderer fails
      let html = markdown
        // Bold
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Code
        .replace(/`(.*?)`/g, '<code style="background: var(--background-secondary); padding: 2px 4px; border-radius: 3px;">$1</code>')
        // Links
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="color: var(--text-accent); text-decoration: none;">$1</a>')
        // Line breaks
        .replace(/\n/g, '<br>');

      element.innerHTML = html;
    }
  }

  adjustWindowSize(windowElement: HTMLElement, contentElement: HTMLElement, text: string) {
    const maxWidth = this.settings.maxWindowWidth;
    const maxHeight = this.settings.maxWindowHeight;
    
    // Get viewport dimensions for reference
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Calculate absolute maximum dimensions (respect both settings and viewport)
    const absoluteMaxWidth = Math.min(maxWidth, viewportWidth - 40);
    const absoluteMaxHeight = Math.min(maxHeight, viewportHeight - 40);
    
    // Parse text to understand content structure
    const lines = text.split('\n');
    const lineCount = lines.length;
    
    // Find the longest line for width calculation
    const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0);
    
    // Estimate content complexity
    const hasCodeBlocks = text.includes('```');
    const hasLists = text.includes('- ') || text.includes('* ') || text.includes('1. ');
    const hasHeadings = /^#{1,6}\s/.test(text);
    const hasTables = text.includes('|');
    const hasImages = text.includes('![');
    
    // More accurate character width estimation
    // Chinese characters are wider (~16px), English characters are narrower (~8px)
    // Use a weighted average based on character types
    let totalCharWidth = 0;
    for (const line of lines) {
      for (const char of line) {
        // Check if character is CJK (Chinese, Japanese, Korean)
        if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(char)) {
          totalCharWidth += 16;
        } else if (char === '\t') {
          totalCharWidth += 32; // Tab is typically 4 spaces
        } else {
          totalCharWidth += 8; // English and other characters
        }
      }
    }
    
    // Calculate average character width
    const avgCharWidth = lines.reduce((sum, line) => sum + line.length, 0) > 0 
      ? totalCharWidth / lines.reduce((sum, line) => sum + line.length, 0) 
      : 9;
    
    // Calculate the width needed to display the longest line without wrapping
    // This is the primary goal: avoid line wrapping
    let idealWidth = 300;
    
    if (longestLine > 0) {
      // Calculate width for the longest line
      idealWidth = longestLine * avgCharWidth;
      
      // Add padding for window chrome (buttons, borders, etc.)
      idealWidth += 60;
      
      // Adjust for content type
      if (hasCodeBlocks) {
        // Code blocks need extra space for line numbers and syntax highlighting
        idealWidth += 40;
      }
      if (hasTables) {
        // Tables need extra space for borders and padding
        idealWidth += 30;
      }
    }
    
    // Ensure minimum width
    idealWidth = Math.max(300, idealWidth);
    
    // Determine final width
    // Priority: show full line without wrapping unless we hit the limit
    let finalWidth: number;
    if (idealWidth <= absoluteMaxWidth) {
      // We can show the full line without hitting limits
      finalWidth = idealWidth;
    } else {
      // We hit the limit, need to allow wrapping
      finalWidth = absoluteMaxWidth;
    }
    
    // Calculate height based on content
    // Estimate line height (typically 20-24px for normal text, more for headings)
    const baseLineHeight = 22;
    
    // Estimate total height needed
    let estimatedHeight = 80; // Base height for window chrome
    
    // Add height for each line
    for (const line of lines) {
      if (line.startsWith('#')) {
        // Headings are taller
        estimatedHeight += baseLineHeight * 1.5;
      } else if (line.trim() === '') {
        // Empty lines
        estimatedHeight += baseLineHeight * 0.5;
      } else {
        // Normal lines
        // If we're allowing wrapping, estimate wrapped lines
        if (finalWidth < idealWidth) {
          const lineWidth = line.length * avgCharWidth;
          const wrapCount = Math.ceil(lineWidth / (finalWidth - 60));
          estimatedHeight += baseLineHeight * Math.max(1, wrapCount);
        } else {
          estimatedHeight += baseLineHeight;
        }
      }
    }
    
    // Adjust for content complexity
    if (hasCodeBlocks) {
      estimatedHeight += 40;
    }
    if (hasLists) {
      estimatedHeight += 20;
    }
    if (hasImages) {
      estimatedHeight += 60;
    }
    
    // Ensure minimum height
    estimatedHeight = Math.max(100, estimatedHeight);
    
    // Determine final height
    let finalHeight: number;
    if (estimatedHeight <= absoluteMaxHeight) {
      // We can show all content without scrolling
      finalHeight = estimatedHeight;
    } else {
      // We hit the limit, need to allow scrolling
      finalHeight = absoluteMaxHeight;
    }
    
    // Apply initial dimensions
    windowElement.style.width = `${finalWidth}px`;
    windowElement.style.height = `${finalHeight}px`;
    
    // Force reflow to get actual content size
    contentElement.style.visibility = 'hidden';
    windowElement.offsetHeight; // Trigger reflow
    
    // Measure actual content size
    const actualContentWidth = contentElement.scrollWidth;
    const actualContentHeight = contentElement.scrollHeight;
    
    // Fine-tune dimensions based on actual rendered content
    // Only increase size, never decrease (to avoid scrollbars)
    if (actualContentWidth > finalWidth - 20 && finalWidth < absoluteMaxWidth) {
      // Content is wider than expected, try to expand
      finalWidth = Math.min(actualContentWidth + 30, absoluteMaxWidth);
    }
    
    if (actualContentHeight > finalHeight - 20 && finalHeight < absoluteMaxHeight) {
      // Content is taller than expected, try to expand
      finalHeight = Math.min(actualContentHeight + 30, absoluteMaxHeight);
    }
    
    // Apply final dimensions
    windowElement.style.width = `${finalWidth}px`;
    windowElement.style.height = `${finalHeight}px`;
    
    contentElement.style.visibility = 'visible';
    
    // Ensure window doesn't go off-screen
    this.ensureWindowWithinBounds(windowElement);
  }

  ensureWindowWithinBounds(windowElement: HTMLElement) {
    const rect = windowElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let left = parseFloat(windowElement.style.left) || 100;
    let top = parseFloat(windowElement.style.top) || 100;
    
    // Adjust if window goes beyond right edge
    if (rect.right > viewportWidth) {
      left = viewportWidth - rect.width - 20;
    }
    
    // Adjust if window goes beyond bottom edge
    if (rect.bottom > viewportHeight) {
      top = viewportHeight - rect.height - 20;
    }
    
    // Ensure minimum position
    left = Math.max(20, left);
    top = Math.max(20, top);
    
    windowElement.style.left = `${left}px`;
    windowElement.style.top = `${top}px`;
  }

  setWindowPosition(windowElement: HTMLElement, selectionRect?: DOMRect | null) {
    if (selectionRect) {
      // Calculate position based on selection - position at bottom right of selection
      let left = selectionRect.right + 20; // 20px gap to the right of selection
      let top = selectionRect.bottom + 10; // 10px gap below the selection
      
      // Set initial position
      windowElement.style.left = `${left}px`;
      windowElement.style.top = `${top}px`;
    } else {
      // Default position if no selection rect
      windowElement.style.left = '100px';
      windowElement.style.top = '100px';
    }
  }

  jumpToOriginalParagraph(text: string, selectionRect?: DOMRect | null) {
    try {
      const activeLeaf = this.app.workspace.activeLeaf;
      if (activeLeaf && activeLeaf.view && 'editor' in activeLeaf.view) {
        const editor = activeLeaf.view.editor as Editor;
        if (editor) {
          // Focus on the editor
          editor.focus();
          
          // Find the exact position of the text in the document
          const content = editor.getValue();
          const textToFind = text.trim();
          
          if (textToFind) {
            // Search for the text in the document
            const index = content.indexOf(textToFind);
            if (index !== -1) {
              // Get the line and character position
              const lines = content.substring(0, index).split('\n');
              const line = lines.length - 1;
              const ch = lines[lines.length - 1].length;
              
              // Set cursor to the position for better user feedback
              editor.setCursor({ line, ch });
              
              // Use a different approach to scroll to the position
              // This should position the line in the middle of the view
              editor.scrollIntoView({ from: { line, ch }, to: { line, ch } }, true);
              
              // Additional scroll adjustment to move the line up
              // This is a workaround to position the line in the upper half
              setTimeout(() => {
                const view = activeLeaf.view;
                if (view && 'contentEl' in view) {
                  const contentEl = view.contentEl as HTMLElement;
                  if (contentEl && 'scrollTop' in contentEl) {
                    const scrollTop = contentEl.scrollTop;
                    contentEl.scrollTop = Math.max(0, scrollTop - 100); // Adjust 100px up
                  }
                }
              }, 100);
            } else {
              // Fallback to top if text not found
              editor.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }, true);
            }
          } else {
            // Fallback to top if no text
            editor.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }, true);
          }
          
          // Show success message
          const message = this.settings.language === 'zh' ? '已跳转至文本所在段落' : 'Jumped to paragraph location';
          new Notice(message);
        }
      }
    } catch (error) {
      console.error('Error jumping to original paragraph:', error);
      const errorMessage = this.settings.language === 'zh' ? '跳转失败，请手动定位' : 'Jump failed, please locate manually';
      new Notice(errorMessage);
    }
  }

  addButtonTooltip(button: HTMLElement) {
    let tooltipTimeout: number;
    let tooltipElement: HTMLElement | null = null;
    
    button.addEventListener('mouseenter', (e) => {
      tooltipTimeout = setTimeout(() => {
        // Create tooltip element
        tooltipElement = document.createElement('div');
        tooltipElement.className = 'floating-window-tooltip';
        tooltipElement.style.position = 'fixed';
        tooltipElement.style.zIndex = '10001';
        tooltipElement.style.backgroundColor = 'var(--background-primary)';
        tooltipElement.style.color = 'var(--text-normal)';
        tooltipElement.style.border = '1px solid var(--border-color)';
        tooltipElement.style.borderRadius = '4px';
        tooltipElement.style.padding = '8px 12px';
        tooltipElement.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
        tooltipElement.style.fontSize = 'var(--font-ui-smaller)';
        tooltipElement.style.pointerEvents = 'none';
        
        // Set tooltip position
        tooltipElement.style.left = `${e.clientX + 10}px`;
        tooltipElement.style.top = `${e.clientY + 10}px`;
        
        // Set tooltip text based on language
        const zhText = '跳转至文本所在段落';
        const enText = 'Jump to paragraph location';
        tooltipElement.textContent = this.settings.language === 'zh' ? zhText : enText;
        
        // Add tooltip to document
        document.body.appendChild(tooltipElement);
      }, 500); // 500ms delay
    });
    
    button.addEventListener('mouseleave', () => {
      clearTimeout(tooltipTimeout);
      if (tooltipElement) {
        tooltipElement.remove();
        tooltipElement = null;
      }
    });
    
    button.addEventListener('click', () => {
      clearTimeout(tooltipTimeout);
      if (tooltipElement) {
        tooltipElement.remove();
        tooltipElement = null;
      }
    });
  }

};

class FloatingWindowSettingTab extends PluginSettingTab {
  plugin: FloatingWindowPlugin;

  constructor(app: any, plugin: FloatingWindowPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl('h2', { text: this.plugin.settings.language === 'zh' ? '悬浮窗口插件设置' : 'Floating Window Plugin Settings' });

    // Window behavior
    containerEl.createEl('h3', { text: this.plugin.settings.language === 'zh' ? '窗口行为' : 'Window Behavior' });

    // Show close button
    new Setting(containerEl)
      .setName(this.plugin.settings.language === 'zh' ? '显示关闭按钮' : 'Show Close Button')
      .setDesc(this.plugin.settings.language === 'zh' ? '在悬浮窗口上显示关闭按钮' : 'Display a close button on floating windows')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.showCloseButton)
        .onChange(async (value) => {
          this.plugin.settings.showCloseButton = value;
          await this.plugin.saveSettings();
        })
      );

    // Enable smooth transitions
    new Setting(containerEl)
      .setName(this.plugin.settings.language === 'zh' ? '平滑过渡' : 'Smooth Transitions')
      .setDesc(this.plugin.settings.language === 'zh' ? '为窗口操作启用平滑动画' : 'Enable smooth animations for window operations')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.enableSmoothTransitions)
        .onChange(async (value) => {
          this.plugin.settings.enableSmoothTransitions = value;
          await this.plugin.saveSettings();
        })
      );

    // Keyboard Shortcut
    containerEl.createEl('h3', { text: this.plugin.settings.language === 'zh' ? '键盘快捷键' : 'Keyboard Shortcut' });
    
    new Setting(containerEl)
      .setName(this.plugin.settings.language === 'zh' ? '打开悬浮窗口' : 'Open Floating Window')
      .setDesc(this.plugin.settings.language === 'zh' ? '自定义打开悬浮窗口的键盘快捷键' : 'Customize the keyboard shortcut for opening selected text in a floating window')
      .addButton((button) => button
        .setButtonText(this.plugin.settings.language === 'zh' ? '自定义' : 'Customize')
        .onClick(() => {
          // Open Obsidian's hotkey settings
          const message = this.plugin.settings.language === 'zh' ? '请在Obsidian设置 → 热键中自定义快捷键 → Floating Window Plugin' : 'Please customize the hotkey in Obsidian settings under Hotkeys → Floating Window Plugin';
          new Notice(message);
          // In Obsidian, users can customize hotkeys through the settings interface
        })
      );
    
    containerEl.createEl('p', {
      text: this.plugin.settings.language === 'zh' ? '当前默认: Alt+w' : 'Current default: Alt+w',
      cls: 'setting-item-description'
    });
    
    // Window Size Settings
    containerEl.createEl('h3', { text: this.plugin.settings.language === 'zh' ? '窗口尺寸设置' : 'Window Size Settings' });
    
    // Max Window Width
    new Setting(containerEl)
      .setName(this.plugin.settings.language === 'zh' ? '最大窗口宽度' : 'Max Window Width')
      .setDesc(this.plugin.settings.language === 'zh' ? '悬浮窗口的最大宽度（像素）' : 'Maximum width of floating windows (pixels)')
      .addText((text) => text
        .setValue(String(this.plugin.settings.maxWindowWidth))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 300) {
            this.plugin.settings.maxWindowWidth = numValue;
            await this.plugin.saveSettings();
          }
        })
      );
    
    // Max Window Height
    new Setting(containerEl)
      .setName(this.plugin.settings.language === 'zh' ? '最大窗口高度' : 'Max Window Height')
      .setDesc(this.plugin.settings.language === 'zh' ? '悬浮窗口的最大高度（像素）' : 'Maximum height of floating windows (pixels)')
      .addText((text) => text
        .setValue(String(this.plugin.settings.maxWindowHeight))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue >= 100) {
            this.plugin.settings.maxWindowHeight = numValue;
            await this.plugin.saveSettings();
          }
        })
      );
    
    // Language Settings
    containerEl.createEl('h3', { text: this.plugin.settings.language === 'zh' ? '语言设置' : 'Language Settings' });
    
    new Setting(containerEl)
      .setName(this.plugin.settings.language === 'zh' ? '语言' : 'Language')
      .setDesc(this.plugin.settings.language === 'zh' ? '选择插件界面语言' : 'Select plugin interface language')
      .addDropdown((dropdown) => dropdown
        .addOption('zh', '中文')
        .addOption('en', 'English')
        .setValue(this.plugin.settings.language)
        .onChange(async (value: string) => {
          this.plugin.settings.language = value as 'zh' | 'en';
          await this.plugin.saveSettings();
          // Refresh settings tab to show new language
          this.display();
        })
      );
  }
}

