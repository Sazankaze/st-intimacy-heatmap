// 1. 最外层日志：只要文件被读到了，这行字一定会出来
console.log("%c【1】插件文件 index.js 已经被浏览器读取到了！", "color: green; font-size: 20px; font-weight: bold;");

jQuery(document).ready(function () {
    // 2. DOM 就绪日志
    console.log("【2】页面基础结构加载完毕，开始准备寻找菜单...");

    // 3. 定义按钮 HTML
    const buttonHtml = `
        <div class="menu_button" id="my_debug_btn" style="background-color: darkred; color: white; font-weight: bold;">
            ⚠️ 测试按钮
        </div>
    `;

    // 4. 使用“轮询”机制
    // SillyTavern 的菜单有时是后生成的，普通代码跑太快会找不到，所以我们要每隔1秒找一次
    let attempts = 0;
    const searchTimer = setInterval(function() {
        attempts++;
        const menu = $('#extensionsMenu');

        if (menu.length > 0) {
            // 找到菜单了！
            console.log(`%c【3】成功找到 #extensionsMenu (尝试了 ${attempts} 次)`, "color: blue");
            
            menu.append(buttonHtml);
            console.log("%c【4】按钮 HTML 已插入页面！", "color: blue");
            
            // 停止寻找
            clearInterval(searchTimer);
            
            // 绑定点击事件
            $('#my_debug_btn').on('click', function() {
                console.log("%c【5】点击成功！", "color: orange; font-size: 16px");
                alert("加载成功！");
            });
            
        } else {
            console.log(`...第 ${attempts} 次尝试寻找菜单，未找到...`);
            // 如果找了10秒还没找到，可能是ID变了或者插件没启用
            if (attempts >= 10) {
                console.error("【失败】找了10次都没找到 #extensionsMenu，请检查插件是否在设置里被禁用了，或者ST版本过旧。");
                clearInterval(searchTimer);
            }
        }
    }, 1000); // 每 1000 毫秒（1秒）运行一次
});