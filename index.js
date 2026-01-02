jQuery(document).ready(function () {
    // 1. 定义按钮的 HTML
    // 使用 "menu_button" 类可以保持与 SillyTavern 原生 UI 风格一致
    // 使用 "fa-solid fa-flask" 图标 (FontAwesome) 只是为了好看，可删
    const buttonHtml = `
        <div class="menu_button" id="my_test_plugin_btn">
            <i class="fa-solid fa-flask"></i> 测试
        </div>
    `;

    // 2. 将按钮添加到 #extensionsMenu
    // 这里使用了 append 方法将按钮加到菜单列表的最后
    $('#extensionsMenu').append(buttonHtml);

    // 3. 绑定点击事件
    // 当点击该 ID 的元素时，执行回调函数
    $(document).on('click', '#my_test_plugin_btn', function () {
        console.log('加载成功');
        
        // 如果你也想弹出一个简单的 Toast 提示 (SillyTavern 自带功能)，可以取消下面这行的注释:
        // toastr.success('加载成功'); 
    });
});