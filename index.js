import { getContext } from "../../../extensions.js";
import { getPastCharacterChats } from '../../../../script.js';

const extensionName = "st-intimacy-heatmap";

// === 诊断专用函数 ===
async function runDiagnostic() {
    const context = getContext();
    const charId = context.characterId;
    
    // 准备诊断报告的 HTML
    let reportHtml = `<div style="text-align:left; font-family:monospace; font-size:12px; line-height:1.4;">`;
    
    // 1. 检查环境基本信息
    reportHtml += `<div><strong>--- 1. 环境基础信息 ---</strong></div>`;
    reportHtml += `<div>CharID (原始值): <span style="color:#facc15">${JSON.stringify(charId)}</span></div>`;
    reportHtml += `<div>CharID (类型): ${typeof charId}</div>`;

    let charObj = null;
    let avatarFile = "未找到";
    let charName = "未找到";

    // 尝试获取角色对象
    try {
        if (context.characters) {
            // 情况A: characters 是数组
            if (Array.isArray(context.characters)) {
                reportHtml += `<div>Characters类型: Array (长度: ${context.characters.length})</div>`;
                charObj = context.characters[charId];
            } 
            // 情况B: characters 是对象 (某些旧版本)
            else {
                reportHtml += `<div>Characters类型: Object</div>`;
                charObj = context.characters[charId];
            }
        }

        if (charObj) {
            avatarFile = charObj.avatar;
            charName = charObj.name;
            reportHtml += `<div><span style="color:#4ade80">✔ 成功获取角色对象</span></div>`;
            reportHtml += `<div>Display Name: ${charName}</div>`;
            reportHtml += `<div>Avatar File: <span style="color:#f472b6">${avatarFile}</span></div>`;
        } else {
            reportHtml += `<div><span style="color:#ef4444">❌ 无法通过 ID ${charId} 找到角色对象</span></div>`;
        }
    } catch (e) {
        reportHtml += `<div>❌ 读取角色信息报错: ${e.message}</div>`;
    }

    reportHtml += `<br><div><strong>--- 2. 聊天文件与路径测试 ---</strong></div>`;

    try {
        const chats = await getPastCharacterChats(charId);
        if (chats && chats.length > 0) {
            const targetFile = chats[chats.length - 1]; // 取最新的一个文件测试
            const fileName = targetFile.file_name;
            reportHtml += `<div>目标文件名: ${fileName}</div>`;
            
            // 构建我们需要测试的“嫌疑路径”
            const candidates = [];

            // 嫌疑人A: 基于 Avatar 文件名 (去后缀)
            if (avatarFile && typeof avatarFile === 'string') {
                const folder = avatarFile.replace(/\.[^/.]+$/, "");
                candidates.push({ type: 'AvatarFolder', folder: folder });
            }

            // 嫌疑人B: 基于 Avatar 文件名 (直接用，有些版本就是这么怪)
            if (avatarFile) {
                candidates.push({ type: 'AvatarRaw', folder: avatarFile });
            }

            // 嫌疑人C: 基于文件名拆分
            const splitName = fileName.split(' - ')[0];
            if (splitName) {
                candidates.push({ type: 'SplitName', folder: splitName });
            }

            // 嫌疑人D: 仅仅是 ID
            candidates.push({ type: 'ID', folder: String(charId) });

            reportHtml += `<div>正在尝试 ${candidates.length} 种路径组合...</div><br>`;

            let success = false;

            // 开始逐个“撞库”
            for (const cand of candidates) {
                const encodedFile = encodeURIComponent(fileName);
                
                // 组合1: 编码的文件夹
                const path1 = `/chats/${encodeURIComponent(cand.folder)}/${encodedFile}`;
                // 组合2: 不编码的文件夹
                const path2 = `/chats/${cand.folder}/${encodedFile}`;
                
                // 测试 Path 1
                const res1 = await fetch(path1, { method: 'GET' });
                const color1 = res1.ok ? '#4ade80' : '#ef4444';
                reportHtml += `<div>[${cand.type}] 尝试: ${path1} <br> -> <span style="color:${color1}">${res1.status} ${res1.statusText}</span></div>`;

                if (res1.ok) {
                    success = true;
                    reportHtml += `<div><strong style="color:#4ade80">✨ 找到正确路径! 就是它!</strong></div>`;
                    break;
                }

                // 测试 Path 2 (如果和1不一样)
                if (path1 !== path2) {
                    const res2 = await fetch(path2, { method: 'GET' });
                    const color2 = res2.ok ? '#4ade80' : '#ef4444';
                    reportHtml += `<div>[${cand.type}-Raw] 尝试: ${path2} <br> -> <span style="color:${color2}">${res2.status} ${res2.statusText}</span></div>`;
                    if (res2.ok) {
                        success = true;
                        reportHtml += `<div><strong style="color:#4ade80">✨ 找到正确路径 (无编码)! 就是它!</strong></div>`;
                        break;
                    }
                }
            }

            if (!success) {
                reportHtml += `<br><div style="color:#ef4444; font-weight:bold;">💀 所有常规路径均失败。Reference.js 肯定用了什么黑魔法。</div>`;
            }

        } else {
            reportHtml += `<div>❌ 未找到该角色的聊天记录列表</div>`;
        }
    } catch (e) {
        reportHtml += `<div>❌ 聊天记录读取流程报错: ${e.message}</div>`;
    }

    reportHtml += `</div>`;

    // 渲染弹窗
    if ($('#st-diag-modal').length > 0) $('#st-diag-modal').remove();
    $('body').append(`
        <div id="st-diag-modal" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        background:#0f172a;padding:20px;border:2px solid #ef4444;z-index:99999;border-radius:10px;
        box-shadow:0 0 50px rgba(0,0,0,0.9);width:600px;max-height:80vh;overflow-y:auto;color:#cbd5e1;">
            <h3 style="margin-top:0;color:#ef4444;">🕵️‍♂️ 路径侦探诊断报告</h3>
            <div style="background:#1e293b; padding:10px; border-radius:5px; margin-bottom:15px;">
                ${reportHtml}
            </div>
            <div style="font-size:12px; color:#94a3b8; margin-bottom:10px;">
                请截图这个窗口的内容，或复制上面的信息发给我。
            </div>
            <button id="st-diag-close" class="menu_button" style="width:100%">关闭</button>
        </div>
    `);
    $('#st-diag-close').click(() => $('#st-diag-modal').remove());
}

jQuery(async () => {
    const menuBtn = `
        <div id="st-diag-trigger" class="list-group-item" style="cursor:pointer; display:flex; align-items:center; background: #450a0a;">
            <span style="margin-right:10px; width:20px; text-align:center;">
                <i class="fa-solid fa-bug" style="color: #ef4444;"></i>
            </span>
            <span>运行路径诊断 (Debug)</span>
        </div>
    `;

    const intv = setInterval(() => {
        if ($('#extensionsMenu').length > 0) {
            if ($('#st-diag-trigger').length === 0) {
                $('#extensionsMenu').append(menuBtn);
                $('#st-diag-trigger').on('click', runDiagnostic);
            }
            clearInterval(intv);
        }
    }, 500);
    
    console.log("ST-Diagnostic Loaded");
});