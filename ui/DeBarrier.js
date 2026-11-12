// DeBarrier: opens a regular DSM window with the DeBarrier page inside.
Ext.ns("DeBarrier");

Ext.define("DeBarrier.AppInstance", {
	extend: "SYNO.SDS.AppInstance",
	appWindowName: "DeBarrier.AppWindow"
});

Ext.define("DeBarrier.AppWindow", {
	extend: "SYNO.SDS.AppWindow",

	constructor: function(config) {
		this.appInstance = config.appInstance;
		config = Ext.apply({
			resizable: true,
			maximizable: true,
			minimizable: true,
			width: 1080,
			height: 720,
			minWidth: 880,
			minHeight: 600,
			items: [{
				xtype: "box",
				autoEl: {
					tag: "iframe",
					src: "/webman/3rdparty/DeBarrier/index.html?v=@VERSION@",
					width: "100%",
					height: "100%",
					frameborder: "0",
					style: "background:#04040c"
				}
			}]
		}, config);
		this.callParent([config]);
	}
});
