FAR.db = null;
FAR.currentConn = null;
FAR.fileIndex = [];

FAR.leftPath = '/';
FAR.rightPath = '/';
FAR.leftFiles = [];
FAR.rightFiles = [];

FAR.activePanel = 'left';

FAR.leftSelectedIdx = new Set();
FAR.rightSelectedIdx = new Set();
FAR.leftAnchor = -1;
FAR.rightAnchor = -1;

FAR.leftCursor = -1;
FAR.rightCursor = -1;

FAR.currentFileData = null;
FAR.currentFileName = '';
FAR.currentFileType = '';

FAR.connModalRequired = false;

FAR.progress = {
    active: false,
    cancelled: false,
    current: 0,
    total: 0,
    errors: 0,
    title: '',
    icon: '',
    logLines: [],
    onCancel: null,
    minimized: false,
    autoCloseTimer: null
};