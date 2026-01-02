import { getContext } from "../../../extensions.js";
import { getPastCharacterChats } from '../../../../script.js';

const extensionName = "st-intimacy-heatmap";
const extensionCss = `/scripts/extensions/third-party/${extensionName}/style.css`;

// === 1. 直接照搬 Reference.js 的日期解析 (最稳) ===
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
    // Fallback
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? null : d;
}

// === 2. 核心：照搬 Reference.js 的 Fetch 逻辑 ===
// 关键区别：Reference.js 在使用 ID 找路径时，**不**对文件夹名编码！
async function fetchSingleChatFile(folderNameFromId, fileName) {
    if (!fileName) return [];
    
    const encodedFileName = encodeURIComponent(fileName);
    let messages = [];

    // --- 尝试 1: 使用 characterId (文件夹名不编码) ---
    // Reference.js 逻辑: const path1 = `/chats/${folderNameFromId}/${encodedFileName}`;
    if (folderNameFromId) {
        const path1 = `/chats/${folderNameFromId}/${encodedFileName}`;
        try {
            const res = await fetch(path1, { method: 'GET', credentials: 'same-origin' });
            if (res.ok) {
                const text = await res.text();
                // 简单的 JSONL 解析
                messages = text.trim().split('\n').map(line => {
                    try { return JSON.parse(line); } catch(e) { return null; }
                }).filter(m => m);
                return messages; // 成功拿到就返回
            }
        } catch (e) {
            // 忽略错误，继续尝试下一个方法
        }
    }

    // --- 尝试 2: 使用文件名里的角色名 (文件夹名编码) ---
    // Reference.js 逻辑: const encodedFolderB = encodeURIComponent(charNameFromFill);
    try {
        const charNameFromFill = fileName.split(' - ')[0];
        if (charNameFromFill && charNameFromFill !== fileName) {
            const encodedFolderB = encodeURIComponent(charNameFromFill);
            const path2 = `/chats/${encodedFolderB}/${encodedFileName}`;
            const res = await fetch(path2, { method: 'GET', credentials: 'same-origin' });
            if (res.ok) {
                const text = await res.text();
                messages = text.trim().split('\n').map(line => {
                    try { return JSON.parse(line); } catch(e) { return null; }
                }).filter(m => m);
                return messages;
            }
        }
    } catch (e) { }

    return [];
}

// === 3. 简单的并发控制 (为了读取所有文件) ===
async function getAllMessages(charId) {
    const chats = await getPastCharacterChats(charId);
    if (!chats || chats.length === 0) return [];

    // 准备 Reference.js 风格的 folderNameFromId
    // 逻辑：如果有后缀(如.png)就去掉，没有就直接用
    const lastDotIndex = charId.lastIndexOf('.');
    const folderNameFromId = lastDotIndex > 0 ? charId.substring(0, lastDotIndex) : charId;

    let allMessages = [];
    
    // 简单的串行读取，确保不崩 (为了调试稳定，先不用并发)
    let count = 0;
    for (const chat of chats) {
        count++;
        // 更新 UI 进度
        $('#st-test-status').text(`正在读取文件 ${count} / ${chats.length}...`);
        
        const msgs = await fetchSingleChatFile(folderNameFromId, chat.file_name);
        allMessages = allMessages.concat(msgs);
    }
    
    return allMessages;
}

// === 4. 极简 UI 用于测试 ===
async function runTest() {
    const context = getContext();
    const charId = context.characterId;
    
    if (!charId) {
        alert("请先选择一个角色！");
        return;
    }

    // 插入测试弹窗
    if ($('#st-test-modal').length === 0) {
        $('body').append(`
            <div id="st-test-modal" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
            background:#1f2937;padding:20px;border:1px solid #4b5563;z-index:9999;border-radius:8px;
            box-shadow:0 0 10px rgba(0,0,0,0.5);min-width:300px;text-align:center;color:white;">
                <h3 style="margin-top:0">数据读取测试</h3>
                <div id="st-test-status" style="margin:20px 0;color:#aaa;">准备开始...</div>
                <div id="st-test-result" style="font-weight:bold;font-size:1.2em;margin-bottom:20px;"></div>
                <button id="st-test-close" class="menu_button">关闭</button>
            </div>
        `);
        $('#st-test-close').click(() => $('#st-test-modal').remove());
    }

    try {
        const msgs = await getAllMessages(charId);
        
        // 简单统计验证
        const validMsgs = msgs.filter(m => m.send_date);
        validMsgs.sort((a,b) => parseSillyTavernDate(a.send_date) - parseSillyTavernDate(b.send_date));

        const firstDate = validMsgs.length > 0 ? validMsgs[0].send_date : "无";
        const lastDate = validMsgs.length > 0 ? validMsgs[validMsgs.length-1].send_date : "无";

        $('#st-test-status').text("读取完成！");
        $('#st-test-result').html(`
            成功读取条数: ${msgs.length}<br>
            有效时间戳: ${validMsgs.length}<br>
            <hr style="border-color:#444">
            最早: ${firstDate}<br>
            最近: ${lastDate}
        `);

    } catch (e) {
        $('#st-test-status').text("出错了: " + e.message);
    }
}

jQuery(async () => {
    // 注入按钮
    const menuBtn = `
        <div id="st-test-trigger" class="list-group-item" style="cursor:pointer; display:flex; align-items:center;">
            <span>🔍 情感档案-连通性测试</span>
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
    
    console.log("ST-Intimacy-Test Loaded");
});