// ==UserScript==
// @name         MOOC 自动互评
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  自动完成中国大学MOOC作业互评，具备白卷识别、随机评语、自定义操作间隔、自动提交并下一份、必评任务完成后自动停止功能。
// @author       Maliang
// @match        *://www.icourse163.org/learn/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @downloadURL  https://raw.githubusercontent.com/maliang233/icourseAutoRate/mooc_auto_rate.user.js
// @updateURL    https://raw.githubusercontent.com/maliang233/icourseAutoRate/mooc_auto_rate.user.js
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const MIN_SAFE_DELAY = 1;
    const MAX_SAFE_DELAY = 10000;
    const DEFAULT_PRAISES = [
        "回答得非常专业，逻辑清晰，很有参考价值！",
        "思路独特，条理分明，完成得非常棒。",
        "要点抓取得很准，图片和文字配合得很好，学习了。",
        "工作量扎实，内容详实，符合题目要求。",
        "表达准确，步骤完整，是一份优秀的作业。"
    ].join('\n');

    let config = {
        isRunning: GM_getValue('auto_eval_running', false),
        isExpanded: GM_getValue('panel_expanded', true),
        isSettingShow: false,
        praises: GM_getValue('praise_list', DEFAULT_PRAISES),
        baseDelay: GM_getValue('base_delay', 1500),
        autoSubmit: GM_getValue('auto_submit', true),
        pos: GM_getValue('panel_pos', { top: 100, left: window.innerWidth - 280 })
    };

    let isProcessing = false;

    function initGUI() {
        if (document.getElementById('mooc-eval-panel')) return;
        GM_addStyle(`
            #mooc-eval-panel { position: fixed; top: ${config.pos.top}px; left: ${config.pos.left}px; z-index: 2147483647; background: #fff; border: 1px solid #00cc7e; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); width: 240px; font-family: sans-serif; overflow: hidden; box-sizing: border-box; }
            #mooc-eval-panel * { box-sizing: border-box; }
            #panel-header { background: #00cc7e; color: white; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; cursor: move; font-weight: bold; font-size: 13px; }
            #panel-content { padding: 10px; display: ${config.isExpanded ? 'block' : 'none'}; }
            .btn-group { display: flex; gap: 8px; margin-bottom: 10px; }
            .eval-btn { flex: 1; padding: 8px 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; color: white; font-size: 12px; transition: 0.2s; text-align: center; }
            #btn-toggle { background: ${config.isRunning ? '#ff4d4f' : '#00cc7e'}; }
            #btn-settings { background: #6c757d; }
            #log-container { background: #f8f9fa; border: 1px solid #eee; border-radius: 4px; height: 110px; overflow-y: auto; font-size: 11px; padding: 6px; color: #555; line-height: 1.4; }
            .log-entry { margin-bottom: 2px; border-bottom: 1px solid #f1f3f5; word-break: break-all; }
            #settings-area { display: none; border-top: 1px dashed #ddd; margin-top: 10px; padding-top: 10px; font-size: 12px; }
            .setting-item { margin-bottom: 8px; }
            .setting-item label { display: block; margin-bottom: 4px; font-weight: bold; }
            .setting-item input[type="number"] { width: 100%; padding: 4px; border: 1px solid #ccc; border-radius: 4px; }
            .setting-item textarea { width: 100%; height: 70px; font-size: 11px; resize: vertical; border: 1px solid #ccc; border-radius: 4px; }
            #btn-save-config { background: #007bff; width: 100%; }
        `);

        const panel = document.createElement('div');
        panel.id = 'mooc-eval-panel';
        panel.innerHTML = `
            <div id="panel-header"><span>互评助手</span><span id="expand-icon" style="cursor:pointer;">${config.isExpanded ? '▼' : '▲'}</span></div>
            <div id="panel-content">
                <div class="btn-group">
                    <button id="btn-toggle" class="eval-btn">${config.isRunning ? '停止运行' : '开始运行'}</button>
                    <button id="btn-settings" class="eval-btn">设置</button>
                </div>
                <div id="settings-area">
                    <div class="setting-item"><label>随机评语库:</label><textarea id="cfg-praises">${config.praises}</textarea></div>
                    <div class="setting-item"><label>间隔 (ms):</label><input type="number" id="cfg-base-delay" value="${config.baseDelay}"></div>
                    <div class="setting-item"><input type="checkbox" id="cfg-submit" ${config.autoSubmit ? 'checked' : ''}> <label style="display:inline;">自动提交</label></div>
                    <button id="btn-save-config" class="eval-btn">保存</button>
                </div>
                <div id="log-container"></div>
            </div>
        `;
        document.body.appendChild(panel);

        const header = document.getElementById('panel-header');
        header.onmousedown = function(e) {
            if (e.target.id === 'expand-icon') return;
            let startX = e.clientX, startY = e.clientY, initialLeft = panel.offsetLeft, initialTop = panel.offsetTop;
            document.onmousemove = (ev) => {
                panel.style.left = (initialLeft + ev.clientX - startX) + 'px';
                panel.style.top = (initialTop + ev.clientY - startY) + 'px';
            };
            document.onmouseup = () => {
                GM_setValue('panel_pos', { top: panel.offsetTop, left: panel.offsetLeft });
                document.onmousemove = document.onmouseup = null;
            };
        };

        window.addEvalLog = (msg) => {
            const logBox = document.getElementById('log-container');
            const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            logBox.insertAdjacentHTML('afterbegin', `<div class="log-entry"><span style="color:#adb5bd">[${time}]</span> ${msg}</div>`);
            if (logBox.childNodes.length > 30) logBox.lastChild.remove();
        };

        document.getElementById('expand-icon').onclick = (e) => {
            config.isExpanded = !config.isExpanded;
            GM_setValue('panel_expanded', config.isExpanded);
            document.getElementById('panel-content').style.display = config.isExpanded ? 'block' : 'none';
            e.target.innerText = config.isExpanded ? '▼' : '▲';
        };

        document.getElementById('btn-settings').onclick = () => {
            config.isSettingShow = !config.isSettingShow;
            document.getElementById('settings-area').style.display = config.isSettingShow ? 'block' : 'none';
        };

        document.getElementById('btn-save-config').onclick = () => {
            let base = parseInt(document.getElementById('cfg-base-delay').value) || 1500;
            base = Math.max(MIN_SAFE_DELAY, Math.min(MAX_SAFE_DELAY, base));
            const p = document.getElementById('cfg-praises').value.trim() || DEFAULT_PRAISES;
            const s = document.getElementById('cfg-submit').checked;
            config.baseDelay = base; config.praises = p; config.autoSubmit = s;
            GM_setValue('base_delay', base); GM_setValue('praise_list', p); GM_setValue('auto_submit', s);
            document.getElementById('cfg-base-delay').value = base;
            window.addEvalLog('<span style="color:blue">设置已应用</span>');
            document.getElementById('settings-area').style.display = 'none';
            config.isSettingShow = false;
        };

        document.getElementById('btn-toggle').onclick = () => {
            config.isRunning = !config.isRunning;
            GM_setValue('auto_eval_running', config.isRunning);
            document.getElementById('btn-toggle').innerText = config.isRunning ? '停止运行' : '开始运行';
            document.getElementById('btn-toggle').style.background = config.isRunning ? '#ff4d4f' : '#00cc7e';
            window.addEvalLog(config.isRunning ? '<b style="color:green">服务已开启</b>' : '<b style="color:red">服务已暂停</b>');
        };
    }

    const sleepHuman = () => new Promise(r => setTimeout(r, config.baseDelay * (0.8 + Math.random() * 0.4)));

    // 检测回答区域是否有内容
    function hasAnswerContent(scoringContainer) {
        // MOOC 结构：回答内容通常在评分项 (.s) 的上方的兄弟节点中，或共同的父容器内
        let parent = scoringContainer.closest('.m-homework-question, .que, .question-item, li');
        if (!parent) parent = scoringContainer.parentElement;

        const contentBox = parent.querySelector('.f-richEditorText, .j-answer, .ans, .pAnswer');
        const text = contentBox ? contentBox.innerText.trim() : parent.innerText.split('评分标准')[0].trim();
        const hasImg = parent.querySelector('img') !== null;
        const hasFile = parent.querySelector('a[href*="nosdn.127.net"]') !== null;

        return text.length > 2 || hasImg || hasFile;
    }

    async function doWork() {
        if (!config.isRunning || isProcessing) return;
        isProcessing = true;

        try {
            const bodyTxt = document.body.innerText;
            const nextBtn = Array.from(document.querySelectorAll('a, span, button')).find(el =>
                el.innerText.includes("继续评估下一份") && el.offsetParent !== null
            );

            if (nextBtn) {
                if (bodyTxt.includes("还剩余") && bodyTxt.includes("影响成绩")) {
                    window.addEvalLog('任务未完，准备跳转...');
                    await sleepHuman(); nextBtn.click();
                    isProcessing = false; return;
                } else if (bodyTxt.includes("已经提交了") && bodyTxt.includes("评分")) {
                    window.addEvalLog('<b style="color:#007bff">🎉 必评任务已全部完成！</b>');
                    config.isRunning = false; GM_setValue('auto_eval_running', false);
                    document.getElementById('btn-toggle').innerText = '开始运行';
                    document.getElementById('btn-toggle').style.background = '#00cc7e';
                    isProcessing = false; return;
                }
            }

            const containers = document.querySelectorAll('.m-homework .s');
            const textareas = document.querySelectorAll('.j-textarea');
            if (containers.length === 0 && textareas.length === 0) { isProcessing = false; return; }

            let localAction = 0;
            let foundBlank = false;
            const pList = config.praises.split('\n').filter(l => l.trim().length > 0);

            for (let i = 0; i < containers.length; i++) {
                if (!config.isRunning) break;
                const s = containers[i];
                const opts = s.querySelectorAll('.j-select');
                if (opts.length > 0) {
                    const last = opts[opts.length - 1];
                    if (hasAnswerContent(s)) {
                        if (!(last.getAttribute('data-eval-clicked') === 'true' || /\b(z-sel|z-selected|z-on|selected)\b/.test(last.className))) {
                            await sleepHuman();
                            last.click(); last.setAttribute('data-eval-clicked', 'true');
                            window.addEvalLog(`评分项 ${i+1} 已打满分`); localAction++;
                        }
                    } else {
                        foundBlank = true;
                        window.addEvalLog(`<span style="color:#ff4d4f">项 ${i+1} 疑似白卷，已跳过</span>`);
                    }
                }
            }

            for (let i = 0; i < textareas.length; i++) {
                if (!config.isRunning || foundBlank) break;
                const area = textareas[i];
                if (area.value.trim().length < 2) {
                    await sleepHuman();
                    area.value = pList[Math.floor(Math.random() * pList.length)];
                    area.dispatchEvent(new Event('input', { bubbles: true }));
                    area.dispatchEvent(new Event('change', { bubbles: true }));
                    window.addEvalLog('已自动填写评语'); localAction++;
                }
            }

            if (localAction === 0 && config.autoSubmit && !foundBlank) {
                const submitBtn = Array.from(document.querySelectorAll('.u-btn-primary, .u-btn, .j-submit, a, span, button, .u-btn-wait')).find(el => {
                    const t = el.innerText.trim();
                    return (t === "提交" || t === "确定") && !t.includes("下一份") && el.offsetParent !== null;
                });
                if (submitBtn) {
                    window.addEvalLog('<span style="color:blue">内容检查完毕，执行提交...</span>');
                    await sleepHuman();
                    submitBtn.click();
                    ['mousedown', 'mouseup'].forEach(ev => submitBtn.dispatchEvent(new MouseEvent(ev, { bubbles: true })));
                    document.querySelectorAll('[data-eval-clicked]').forEach(e => e.removeAttribute('data-eval-clicked'));
                    await new Promise(r => setTimeout(r, 4000));
                }
            } else if (foundBlank && config.autoSubmit) {
                window.addEvalLog('<span style="color:orange">检测到白卷，已停止自动提交，请手动确认。</span>');
            }

        } catch (e) { console.error('AutoEval Error:', e); } finally { isProcessing = false; }
    }

    const checkTimer = setInterval(() => {
        if (document.body) {
            clearInterval(checkTimer);
            initGUI();
            setInterval(doWork, 3500);
        }
    }, 500);

})();
