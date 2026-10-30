// ============================================================
// 65-change-password.js — Смена пароля пользователя
// ============================================================

FAR.openChangePassword = function() {
    if (FAR.WM && FAR.WM.state.active) {
        FAR.WM.openApp('password_changer');
        return;
    }
    const modal = document.getElementById('changePasswordModal');
    if (!modal) {
        console.error('[Password] Modal not found');
        return;
    }
    document.getElementById('cpOldPass').value = '';
    document.getElementById('cpNewPass').value = '';
    document.getElementById('cpNewPass2').value = '';
    document.getElementById('cpError').textContent = '';
    modal.classList.remove('hidden');
    setTimeout(() => document.getElementById('cpOldPass').focus(), 50);
};

FAR.closeChangePassword = function() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) modal.classList.add('hidden');
};

FAR.closeChangePasswordOutside = function(e) {
    if (e.target === e.currentTarget) FAR.closeChangePassword();
};

FAR.submitChangePassword = async function() {
    const oldPass = document.getElementById('cpOldPass').value;
    const newPass = document.getElementById('cpNewPass').value;
    const newPass2 = document.getElementById('cpNewPass2').value;
    const errEl = document.getElementById('cpError');

    errEl.textContent = '';
    if (!oldPass) { errEl.textContent = 'Введите текущий пароль'; return; }
    if (!newPass) { errEl.textContent = 'Введите новый пароль'; return; }
    if (newPass !== newPass2) { errEl.textContent = 'Пароли не совпадают'; return; }

    const ctx = FAR.side[FAR.activePanel];
    if (!ctx || !ctx.db) { errEl.textContent = 'Нет подключения'; return; }

    const btn = document.querySelector('#changePasswordModal .btn-connect');
    btn.disabled = true;
    btn.textContent = 'Сохранение...';

    try {
        const url = ctx.db.baseUrl + '/api/change-password';
        const headers = { 'Content-Type': 'application/json' };
        if (ctx.db.isProxy) {
            headers['X-Proxy-Target-Token'] = ctx.db.token;
        } else {
            headers['Authorization'] = 'Bearer ' + ctx.db.token;
        }

        const res = await fetch(url, {
            method: 'POST',
            headers: headers,
            credentials: 'include',
            body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
        });

        if (!res.ok) {
            const data = await res.json().catch(()=>({}));
            throw new Error(data.error || ('HTTP ' + res.status));
        }

        FAR.toast('Пароль успешно изменён', 'success');
        FAR.closeChangePassword();
    } catch (e) {
        errEl.textContent = e.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Сохранить';
    }
};

// --- WM App ---
FAR.WM.registerApp({
    id: 'password_changer',
    title: 'Смена пароля',
    icon: '🔐',
    keywords: 'пароль password change',
    singleton: true,
    width: 400,
    height: 350,
    open: async function (win, props) {
        win.bodyEl.style.background = '#1e1e2e';
        win.bodyEl.style.color = '#cdd6f4';
        win.bodyEl.style.padding = '16px';

        win.bodyEl.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:12px; height:100%;">
                <label style="font-size:12px; color:#a6adc8;">Текущий пароль
                    <input type="password" id="wmCpOld" style="width:100%; padding:8px; background:#181825; border:1px solid #45475a; border-radius:5px; color:#cdd6f4; margin-top:4px;">
                </label>
                <label style="font-size:12px; color:#a6adc8;">Новый пароль
                    <input type="password" id="wmCpNew" style="width:100%; padding:8px; background:#181825; border:1px solid #45475a; border-radius:5px; color:#cdd6f4; margin-top:4px;">
                </label>
                <label style="font-size:12px; color:#a6adc8;">Повторите новый пароль
                    <input type="password" id="wmCpNew2" style="width:100%; padding:8px; background:#181825; border:1px solid #45475a; border-radius:5px; color:#cdd6f4; margin-top:4px;">
                </label>
                <div id="wmCpError" style="color:#f38ba8; font-size:12px; flex:1;"></div>
                <div style="display:flex; justify-content:flex-end; gap:8px;">
                    <button id="wmCpCancel" style="padding:8px 18px; background:#585b70; color:#cdd6f4; border:none; border-radius:5px; cursor:pointer;">Отмена</button>
                    <button id="wmCpSubmit" style="padding:8px 18px; background:#a6e3a1; color:#1e1e2e; border:none; border-radius:5px; cursor:pointer; font-weight:bold;">Сохранить</button>
                </div>
            </div>
        `;

        const $ = sel => win.bodyEl.querySelector(sel);
        const btnSubmit = $('#wmCpSubmit');
        const btnCancel = $('#wmCpCancel');
        const errEl = $('#wmCpError');

        btnCancel.onclick = () => FAR.WM.closeWindow(win.id);

        btnSubmit.onclick = async () => {
            const oldPass = $('#wmCpOld').value;
            const newPass = $('#wmCpNew').value;
            const newPass2 = $('#wmCpNew2').value;

            errEl.textContent = '';
            if (!oldPass) { errEl.textContent = 'Введите текущий пароль'; return; }
            if (!newPass) { errEl.textContent = 'Введите новый пароль'; return; }
            if (newPass !== newPass2) { errEl.textContent = 'Пароли не совпадают'; return; }

            const ctx = FAR.side[FAR.activePanel];
            if (!ctx || !ctx.db) { errEl.textContent = 'Нет подключения'; return; }

            btnSubmit.disabled = true;
            btnSubmit.textContent = '...';

            try {
                const url = ctx.db.baseUrl + '/api/change-password';
                const headers = { 'Content-Type': 'application/json' };
                if (ctx.db.isProxy) {
                    headers['X-Proxy-Target-Token'] = ctx.db.token;
                } else {
                    headers['Authorization'] = 'Bearer ' + ctx.db.token;
                }

                const res = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    credentials: 'include',
                    body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
                });

                if (!res.ok) {
                    const data = await res.json().catch(()=>({}));
                    throw new Error(data.error || ('HTTP ' + res.status));
                }

                FAR.toast('Пароль успешно изменён', 'success');
                FAR.WM.closeWindow(win.id);
            } catch (e) {
                errEl.textContent = e.message;
            } finally {
                btnSubmit.disabled = false;
                btnSubmit.textContent = 'Сохранить';
            }
        };
    }
});

// Регистрация в меню Пуск
FAR.WM.APP_CATEGORY_MAP['password_changer'] = 'system';