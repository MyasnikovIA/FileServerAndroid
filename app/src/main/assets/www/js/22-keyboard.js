FAR.setupKeyboard = function() {
    document.addEventListener('keydown', function(e) {
        // === ESC: закрываем модалки по приоритету ===
        if (e.key === 'Escape') {
            const videoModalEsc = document.getElementById('videoViewerModal');
            if (videoModalEsc && !videoModalEsc.classList.contains('hidden')) {
                FAR.closeVideoViewer();
                return;
            }
            const mp3ModalEsc = document.getElementById('mp3ViewerModal');
            if (mp3ModalEsc && !mp3ModalEsc.classList.contains('hidden')) {
                FAR.closeMp3Viewer();
                return;
            }
            const ed = document.getElementById('panoramaEditorModal');
            if (ed && !ed.classList.contains('hidden')) {
                FAR.closePanoramaEditor();
                return;
            }
            const panoModal = document.getElementById('panoramaViewerModal');
            if (panoModal && !panoModal.classList.contains('hidden')) {
                FAR.closePanoramaViewer();
                return;
            }
            const jsdosModalEsc = document.getElementById('jsdosViewerModal');
            if (jsdosModalEsc && !jsdosModalEsc.classList.contains('hidden')) {
                FAR.closeJsdosViewer();
                return;
            }
            const emuModalEsc = document.getElementById('emulatorViewerModal');
            if (emuModalEsc && !emuModalEsc.classList.contains('hidden')) {
                FAR.closeEmulatorViewer();
                return;
            }
            const pdfModalEsc = document.getElementById('pdfViewerModal');
            if (pdfModalEsc && !pdfModalEsc.classList.contains('hidden')) {
                FAR.closePdfViewer();
                return;
            }
            const gpSetupEsc = document.getElementById('gamepadSetupModal');
            if (gpSetupEsc && !gpSetupEsc.classList.contains('hidden')) {
                FAR.closeGamepadSetup();
                return;
            }
            const gpuEsc = document.getElementById('gpuMonitorModal');           // ← НОВОЕ
            if (gpuEsc && !gpuEsc.classList.contains('hidden')) {
                FAR.closeGpuMonitor();
                return;
            }
            if (!FAR.hasActiveProgress()) FAR.closeViewer();
            return;
        }

        // === ОКОННЫЙ РЕЖИМ: клавиатуру получает активное окно WM ===
        if (typeof FAR.WM !== 'undefined' && FAR.WM.state && FAR.WM.state.active) {
            const activeWin = (typeof FAR.WM.getActiveWindow === 'function')
                ? FAR.WM.getActiveWindow()
                : null;
            if (!activeWin || activeWin.appId !== 'explorer') {
                return;
            }
        }

        if (FAR.hasActiveProgress()) return;
        if (!FAR.db) return;

        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

        const connModal = document.getElementById('connModal');
        if (connModal && !connModal.classList.contains('hidden')) return;

        const viewerModal = document.getElementById('viewerModal');
        if (viewerModal && !viewerModal.classList.contains('hidden')) return;

        const edModal = document.getElementById('panoramaEditorModal');
        if (edModal && !edModal.classList.contains('hidden')) return;

        const panoModal2 = document.getElementById('panoramaViewerModal');
        if (panoModal2 && !panoModal2.classList.contains('hidden')) return;

        const jsdosModal2 = document.getElementById('jsdosViewerModal');
        if (jsdosModal2 && !jsdosModal2.classList.contains('hidden')) return;

        const emuModal2 = document.getElementById('emulatorViewerModal');
        if (emuModal2 && !emuModal2.classList.contains('hidden')) return;

        const mp3Modal2 = document.getElementById('mp3ViewerModal');
        if (mp3Modal2 && !mp3Modal2.classList.contains('hidden')) return;

        const videoModal2 = document.getElementById('videoViewerModal');
        if (videoModal2 && !videoModal2.classList.contains('hidden')) return;

        const pdfModal2 = document.getElementById('pdfViewerModal');
        if (pdfModal2 && !pdfModal2.classList.contains('hidden')) return;

        const gpSetup2 = document.getElementById('gamepadSetupModal');
        if (gpSetup2 && !gpSetup2.classList.contains('hidden')) return;

        const gpuModal2 = document.getElementById('gpuMonitorModal');        // ← НОВОЕ
        if (gpuModal2 && !gpuModal2.classList.contains('hidden')) return;

        // === Навигация курсором ===
        const side  = FAR.activePanel;
        const items = side === 'left' ? FAR.leftFiles : FAR.rightFiles;
        const shift = e.shiftKey;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            FAR.moveCursor(side, +1, { shift });
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            FAR.moveCursor(side, -1, { shift });
            return;
        }
        if (e.key === 'PageDown') {
            e.preventDefault();
            FAR.moveCursor(side, +1, { shift, page: true });
            return;
        }
        if (e.key === 'PageUp') {
            e.preventDefault();
            FAR.moveCursor(side, -1, { shift, page: true });
            return;
        }
        if (e.key === 'Home') {
            e.preventDefault();
            FAR.moveCursor(side, 0, { shift, toEdge: 'home' });
            return;
        }
        if (e.key === 'End') {
            e.preventDefault();
            FAR.moveCursor(side, 0, { shift, toEdge: 'end' });
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            const cursor = side === 'left' ? FAR.leftCursor : FAR.rightCursor;
            if (cursor === -1) {
                FAR.goToParent(side);
                return;
            }
            if (cursor >= 0 && cursor < items.length) {
                FAR.handleItemDblClick(side, cursor);
            }
            return;
        }
        if (e.key === 'Backspace') {
            e.preventDefault();
            FAR.navigatePanel(side, '..');
            return;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
            const selSet = side === 'left' ? FAR.leftSelectedIdx : FAR.rightSelectedIdx;
            selSet.clear();
            for (let i = 0; i < items.length; i++) selSet.add(i);
            if (side === 'left') FAR.leftAnchor = 0;
            else FAR.rightAnchor = 0;
            FAR.renderPanel(side);
            e.preventDefault();
            return;
        }

        if (e.key === 'F5') { e.preventDefault(); FAR.refreshFiles(); return; }
        if (e.key === 'F6') { e.preventDefault(); FAR.moveSelected(); return; }
        if (e.key === 'F7') { e.preventDefault(); FAR.createFolder(); return; }
        if (e.key === 'F8' || e.key === 'Delete') { e.preventDefault(); FAR.deleteSelected(); return; }
        if (e.key === 'Insert' && e.ctrlKey) { e.preventDefault(); FAR.copySelected(); return; }
    });
};