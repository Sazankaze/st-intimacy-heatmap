import { getContext } from "../../../extensions.js";
import { getPastCharacterChats } from '../../../../script.js';

const extensionName = "st-intimacy-heatmap";

// === 1. 日期解析 (保持原样) ===
const monthMap = {
    Jan: '01', January: '01', Feb: '02', February: '02', Mar: '03', March: '03',
    Apr: '04', April: '04', May: '05', Jun: '06', June: '06',
    Jul: '07', July: '07', Aug: '08', August: '08', Sep: '09', September: '09',
    Oct: '10', October: '10', Nov: '11', November: '11', Dec: '12', December: '12'
};

function parseSillyTavernDate(dateString) {
    if (!dateString) return null;
    const parts = dateString.match(/(\w+)\s+(\d+),\s+(\d+)\s+(\d+):(\d+)(am|pm)/i);
    if (parts) {
        const monthNumber = monthMap[parts[1]];
        if (!monthNumber) return null;
        let hour = parseInt(parts[4], 10);
        if (parts[6].toLowerCase() === 'pm' && hour !== 12) hour += 12;
        else if (parts[6].toLowerCase() === 'am' && hour === 12) hour = 0;
        const isoLikeString = `${parts[3]}-${monthNumber}-${parts[2].padStart(2, '0')}T${String(hour).padStart(2, '0')}:${parts[5]}:00`;
        return new Date(isoLikeString);
    }
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? null : d;
}

// === 2. 智能路径获取器 (核心修复) ===
async function fetchChatContentSmart(fileName, charId) {
    const context = getContext();
    let folderCandidates = [];

    // --- 线索 1: 从角色对象里查头像文件名 (最靠谱) ---
    // 如果 charId 是 148，我们就去 characters[148] 里找 avatar
    try {
        if (context.characters && context.characters[charId]) {
            const charObj = context.characters[charId];
            if (charObj.avatar) {
                // 如果头像是 "黑田葵.png"，文件夹通常是 "黑田葵"
                const avatarName = charObj.avatar.replace(/\.[^/.]+$/, ""); // 去掉后缀
                folderCandidates.push(avatarName);
            }
            if (charObj.name) {
                // 也尝试直接用角色名 "黑田葵"
                folderCandidates.push(charObj.name);
            }
        }
    } catch (e) { console.warn("查角色对象失败", e); }

    // --- 线索 2: 从聊天文件名里反推 (Reference.js 的备用招数) ---
    // 文件名通常是 "黑田葵 - 2026-01-01.jsonl"
    try {
        const splitName = fileName.split(' - ');
        if (splitName.length > 1) {
            folderCandidates.push(splitName[0]);
        }
    } catch (e) {}

    // --- 线索 3: 盲猜 ID (Reference.js 的第一招，虽然经常 404，但也加上) ---
    if (charId) {
        folderCandidates.push(String(charId));
    }

    // --- 去重 ---
    folderCandidates = [...new Set(folderCandidates)];
    
    // 构造所有可能的 URL，包括编码和未编码的组合
    const encodedFileName = encodeURIComponent(fileName);
    const urlsToTry = [];

    folderCandidates.forEach(folder => {
        if (!folder) return;
        // 尝试编码的文件夹名 (标准)
        urlsToTry.push(`/chats/${encodeURIComponent(folder)}/${encodedFileName}`);
        // 尝试不编码的文件夹名 (某些系统/旧版本)
        urlsToTry.push(`/chats/${folder}/${encodedFileName}`);
    });

    // --- 逐个尝试 ---
    for (const url of urlsToTry) {
        try {
            const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
            if (res.ok) {
                // 成功了！解析并返回
                const text = await res.text();
                return text.trim().split('\n').map(line => {
                    try { return JSON.parse(line); } catch(e) { return null; }
                }).filter(m => m);
            }
        } catch (e) {
            // 这个 URL 不对，继续试下一个，不要报错
        }
    }

    // 如果所有都失败了，返回空
    return [];
}

// === 3. 读取逻辑 ===
async function getAllMessages(charId) {
    const chats = await getPastCharacterChats(charId);
    if (!chats || chats.length === 0) return [];

    let allMessages = [];
    
    // 倒序读取，通常最新的在最后
    let count = 0;
    for (const chat of chats) {
        count++;
        $('#st-test-status').text(`正在分析文件 (${count}/${chats.length})...`);
        
        // 这里的关键是把 charId 传进去，让 fetchChatContentSmart 去查真正的文件夹名
        const msgs = await fetchChatContentSmart(chat.file_name, charId);
        
        if (msgs.length > 0) {
            allMessages = allMessages.concat(msgs);
        } else {
            console.warn(`无法读取文件: ${chat.file_name} (尝试了所有可能的路径)`);
        }
    }
    
    return allMessages;
}

// === 4. UI ===
async function runTest() {
    const context = getContext();
    const charId = context.characterId;
    
    if (charId === undefined || charId === null) {
        alert("请先选择一个角色！");
        return;
    }

    // 弹窗 UI
    if ($('#st-test-modal').length === 0) {
        $('body').append(`
            <div id="st-test-modal" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            background:#1f2937;padding:25px;border:1px solid #4b5563;z-index:9999;border-radius:12px;
            box-shadow:0 10px 25px rgba(0,0,0,0.6);min-width:320px;text-align:center;color:#eee;font-family:sans-serif;">
                <h3 style="margin-top:0; color:#e91e63;"><i class="fa-solid fa-heart-pulse"></i> 情感档案测试</h3>
                <div id="st-test-status" style="margin:15px 0;color:#aaa;font-size:0.9em;">准备读取数据...</div>
                <div id="st-test-result" style="background:#111827; padding:15px; border-radius:8px; margin-bottom:15px; text-align:left; font-family:monospace; font-size:0.85em; min-height:80px;">
                    等待结果...
                </div>
                <button id="st-test-close" class="menu_button" style="width:100%">关闭</button>
            </div>
        `);
        $('#st-test-close').click(() => $('#st-test-modal').remove());
    } else {
        $('#st-test-status').text("准备读取数据...");
        $('#st-test-result').text("等待结果...");
    }

    try {
        const msgs = await getAllMessages(charId);
        
        // 统计
        const validMsgs = msgs.filter(m => m.send_date);
        validMsgs.sort((a,b) => parseSillyTavernDate(a.send_date) - parseSillyTavernDate(b.send_date));

        const firstMsg = validMsgs.length > 0 ? validMsgs[0] : null;
        const lastMsg = validMsgs.length > 0 ? validMsgs[validMsgs.length-1] : null;

        const firstDateStr = firstMsg ? firstMsg.send_date : "未知";
        const lastDateStr = lastMsg ? lastMsg.send_date : "未知";
        
        // 计算天数
        let days = 0;
        if (firstMsg && lastMsg) {
            const d1 = parseSillyTavernDate(firstMsg.send_date);
            const d2 = parseSillyTavernDate(lastMsg.send_date);
            if (d1 && d2) {
                days = Math.floor((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
            }
        }

        $('#st-test-status').html(`<span style="color:#4caf50">✅ 读取成功!</span>`);
        $('#st-test-result').html(`
            <div style="margin-bottom:5px;">📂 消息总数: <span style="color:#fff;font-weight:bold;">${msgs.length}</span></div>
            <div style="margin-bottom:5px;">📅 跨越天数: <span style="color:#fff;font-weight:bold;">${days} 天</span></div>
            <hr style="border-color:#374151; margin:8px 0;">
            <div>⏪ 初次见面: <br><span style="color:#818cf8">${firstDateStr}</span></div>
            <div style="margin-top:5px;">⏩ 最近对话: <br><span style="color:#818cf8">${lastDateStr}</span></div>
        `);

    } catch (e) {
        $('#st-test-status').html(`<span style="color:#ef4444">❌ 读取出错</span>`);
        $('#st-test-result').text(e.message);
        console.error(e);
    }
}

jQuery(async () => {
    const menuBtn = `
        <div id="st-test-trigger" class="list-group-item" style="cursor:pointer; display:flex; align-items:center;">
            <span style="margin-right:10px; width:20px; text-align:center;">
                <i class="fa-solid fa-heart-pulse" style="color: #e91e63;"></i>
            </span>
            <span>情感档案 (修复版)</span>
        </div>
    `;

    const intv = setInterval(() => {
        if ($('#extensionsMenu').length > 0) {
            if ($('#st-test-trigger').length === 0) {
                $('#extensionsMenu').append(menuBtn);
                $('#st-test-trigger').on('click', runTest);
            }
            clearInterval(intv);
        }
    }, 500);
    
    console.log("ST-Intimacy-Fixed Loaded");
});