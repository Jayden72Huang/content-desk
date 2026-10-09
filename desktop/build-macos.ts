/** Reproducible native macOS host. Generated Swift is a build artifact. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
if(process.platform!=='darwin')throw new Error('macOS packaging must run on macOS');
const root=path.resolve(import.meta.dir,'..'),out=path.join(root,'dist','macos'),app=path.join(out,'Content Desk.app');
fs.mkdirSync(out,{recursive:true});if(fs.existsSync(app))fs.rmSync(app,{recursive:true});
const contents=path.join(app,'Contents'),resources=path.join(contents,'Resources'),runtime=path.join(resources,'runtime'),macos=path.join(contents,'MacOS');
for(const dir of [resources,runtime,macos])fs.mkdirSync(dir,{recursive:true});
const names=['server.ts','store.ts','wechat.ts','article-format.ts','preview.html','studio.html','package.json','LICENSE','THIRD-PARTY.md'];
for(const name of names)fs.copyFileSync(path.join(root,name),path.join(runtime,name));
fs.cpSync(path.join(root,'product'),path.join(runtime,'product'),{recursive:true,filter:src=>!src.endsWith('.test.ts')});
fs.cpSync(path.join(root,'node_modules'),path.join(runtime,'node_modules'),{recursive:true,dereference:true});
fs.copyFileSync(fs.realpathSync(process.execPath),path.join(resources,'bun'));fs.chmodSync(path.join(resources,'bun'),0o755);
const iconset=path.join(out,'AppIcon.iconset');fs.mkdirSync(iconset,{recursive:true});
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="32" y="32" width="960" height="960" rx="208" fill="#18211b"/><rect x="66" y="66" width="892" height="892" rx="182" fill="none" stroke="#53634a" stroke-width="4"/><path d="M688 318C640 270 580 252 508 252C364 252 250 368 250 512C250 656 364 772 508 772C580 772 640 754 688 706" fill="none" stroke="#e5d679" stroke-width="80" stroke-linecap="square"/><path d="M584 462L806 242M636 242H806V412" fill="none" stroke="#a9c4a7" stroke-width="51"/></svg>');
for(const size of [16,32,128,256,512])for(const scale of [1,2])await sharp(svg).resize(size*scale).png().toFile(path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`));
execFileSync('iconutil',['-c','icns',iconset,'-o',path.join(resources,'AppIcon.icns')]);
const swift=String.raw`
import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
 var window: NSWindow!
 var web: WKWebView!
 var service: Process?
 var serviceLog: FileHandle?
 var readinessTimer: Timer?
 var terminationSignals:[DispatchSourceSignal]=[]
 var attempts=0
 var quitting=false
 let port=8877
 let instance=UUID().uuidString
 var base: URL { URL(string:"http://127.0.0.1:\(port)")! }
 func applicationDidFinishLaunching(_ note: Notification) {
  for code in [SIGTERM,SIGINT]{signal(code,SIG_IGN);let source=DispatchSource.makeSignalSource(signal:code,queue:.main);source.setEventHandler{NSApp.terminate(nil)};source.resume();terminationSignals.append(source)}
  installMenu()
  window=NSWindow(contentRect:NSRect(x:0,y:0,width:1360,height:900),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
  window.title="Content Desk"; window.minSize=NSSize(width:820,height:620);window.center()
  window.backgroundColor=NSColor(calibratedRed:0.06,green:0.08,blue:0.065,alpha:1)
  let configuration=WKWebViewConfiguration()
  web=WKWebView(frame:.zero,configuration:configuration);web.navigationDelegate=self;web.uiDelegate=self
  window.contentView=web;window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
  web.loadHTMLString("<html><body style='background:#101511;color:#e5d679;font:24px -apple-system;padding:80px'><h1>Content Desk</h1><p>正在打开你的本地工作区…</p></body></html>",baseURL:nil)
  startService()
 }
 func installMenu(){
  let menu=NSMenu();let appItem=NSMenuItem();menu.addItem(appItem);let appMenu=NSMenu();appItem.submenu=appMenu
  appMenu.addItem(withTitle:"关于 Content Desk",action:#selector(about),keyEquivalent:"").target=self
  appMenu.addItem(NSMenuItem.separator());appMenu.addItem(withTitle:"退出 Content Desk",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")
  let editItem=NSMenuItem();editItem.title="编辑";menu.addItem(editItem);let edit=NSMenu(title:"编辑");editItem.submenu=edit
  for (name,action,key) in [("撤销","undo:","z"),("剪切","cut:","x"),("复制","copy:","c"),("粘贴","paste:","v"),("全选","selectAll:","a")]{edit.addItem(withTitle:name,action:Selector(action),keyEquivalent:key)}
  let viewItem=NSMenuItem();viewItem.title="视图";menu.addItem(viewItem);let view=NSMenu(title:"视图");viewItem.submenu=view
  view.addItem(withTitle:"重新载入",action:#selector(reload),keyEquivalent:"r").target=self
  NSApp.mainMenu=menu
 }
 @objc func about(){NSApp.orderFrontStandardAboutPanel(options:[.applicationName:"Content Desk",.applicationVersion:"0.1.0 Community development",.credits:NSAttributedString(string:"Local-first DIY content studio · MIT")])}
 @objc func reload(){web.reload()}
 func startService(){
  guard let resources=Bundle.main.resourceURL else { fail("应用文件不完整，请重新下载。");return }
  let home=FileManager.default.homeDirectoryForCurrentUser
  let data=home.appendingPathComponent(".content-desk")
  do {
   try FileManager.default.createDirectory(at:data,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
   let log=data.appendingPathComponent("desktop.log")
   if !FileManager.default.fileExists(atPath:log.path){FileManager.default.createFile(atPath:log.path,contents:nil,attributes:[.posixPermissions:0o600])}
   serviceLog=try FileHandle(forWritingTo:log);serviceLog?.seekToEndOfFile()
   let process=Process();process.executableURL=resources.appendingPathComponent("bun");process.arguments=[resources.appendingPathComponent("runtime/server.ts").path,"--port",String(port)]
   process.currentDirectoryURL=resources.appendingPathComponent("runtime")
   var environment=ProcessInfo.processInfo.environment
   let paths=[home.appendingPathComponent(".local/bin").path,home.appendingPathComponent(".npm-global/bin").path,home.appendingPathComponent(".bun/bin").path,"/opt/homebrew/bin","/usr/local/bin","/usr/bin","/bin","/usr/sbin","/sbin"]
   environment["PATH"]=paths.joined(separator:":")+":"+(environment["PATH"] ?? "")
   environment["CONTENT_DESK_INSTANCE_ID"]=instance
   process.environment=environment;process.standardOutput=serviceLog;process.standardError=serviceLog
   process.terminationHandler={ [weak self] _ in DispatchQueue.main.async {guard let self=self,!self.quitting else{return};self.readinessTimer?.invalidate();self.fail("本地服务已停止。若端口 8877 已被占用，请退出其他 Content Desk 实例后重新打开。详情见 ~/.content-desk/desktop.log。")}}
   service=process;try process.run()
   readinessTimer=Timer.scheduledTimer(withTimeInterval:0.3,repeats:true){[weak self] _ in self?.checkReady()}
  }catch{fail("无法启动本地服务：\(error.localizedDescription)")}
 }
 func checkReady(){
  attempts+=1;if attempts>100{readinessTimer?.invalidate();service?.terminate();fail("本地服务启动超时。请查看 ~/.content-desk/desktop.log。");return}
  var request=URLRequest(url:base.appendingPathComponent("api/health"));request.timeoutInterval=1
  URLSession.shared.dataTask(with:request){[weak self] data,_,_ in
   guard let self=self,let data=data,let payload=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],payload["instanceId"] as? String==self.instance else{return}
   DispatchQueue.main.async {guard self.readinessTimer?.isValid==true else{return};self.readinessTimer?.invalidate();self.web.load(URLRequest(url:self.base.appendingPathComponent("studio")))}
  }.resume()
 }
 func fail(_ message:String){guard !quitting else{return};let alert=NSAlert();alert.messageText="Content Desk 暂时无法打开";alert.informativeText=message;alert.addButton(withTitle:"退出");alert.runModal();NSApp.terminate(nil)}
 func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{return true}
 func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply{
  if quitting{return .terminateNow};quitting=true;readinessTimer?.invalidate()
  guard let process=service,process.isRunning else{return .terminateNow}
  process.terminationHandler={_ in DispatchQueue.main.async {NSApp.reply(toApplicationShouldTerminate:true)}}
  process.terminate()
  DispatchQueue.main.asyncAfter(deadline:.now()+4){if process.isRunning{kill(process.processIdentifier,SIGKILL)};NSApp.reply(toApplicationShouldTerminate:true)}
  return .terminateLater
 }
 func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){
  guard let url=action.request.url else{decisionHandler(.cancel);return}
  let local=url.host=="127.0.0.1" && url.port==port
  let localBlob=url.absoluteString.hasPrefix("blob:http://127.0.0.1:\(port)/")
  if action.shouldPerformDownload && (local || localBlob){decisionHandler(.download);return}
  if url.scheme=="about" || local{decisionHandler(.allow);return}
  if action.navigationType == .linkActivated && ["https","http"].contains(url.scheme ?? ""){NSWorkspace.shared.open(url)}
  decisionHandler(.cancel)
 }
 func webView(_ webView:WKWebView,navigationAction:WKNavigationAction,didBecome download:WKDownload){download.delegate=self}
 func download(_ download:WKDownload,decideDestinationUsing response:URLResponse,suggestedFilename:String,completionHandler:@escaping(URL?)->Void){
  let panel=NSSavePanel();panel.nameFieldStringValue=(suggestedFilename as NSString).lastPathComponent
  panel.beginSheetModal(for:window){result in completionHandler(result == .OK ? panel.url:nil)}
 }
 func download(_ download:WKDownload,didFailWithError error:Error,resumeData:Data?){
  if (error as NSError).code == NSURLErrorCancelled{return}
  let alert=NSAlert();alert.messageText="导出未完成";alert.informativeText=error.localizedDescription;alert.beginSheetModal(for:window)
 }
 func webView(_ webView:WKWebView,runJavaScriptAlertPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping()->Void){let alert=NSAlert();alert.messageText=message;alert.beginSheetModal(for:window){_ in completionHandler()}}
 func webView(_ webView:WKWebView,runJavaScriptConfirmPanelWithMessage message:String,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping(Bool)->Void){let alert=NSAlert();alert.messageText=message;alert.addButton(withTitle:"继续");alert.addButton(withTitle:"取消");alert.beginSheetModal(for:window){response in completionHandler(response == .alertFirstButtonReturn)}}
 func webView(_ webView:WKWebView,runOpenPanelWith parameters:WKOpenPanelParameters,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping([URL]?)->Void){let panel=NSOpenPanel();panel.allowsMultipleSelection=parameters.allowsMultipleSelection;panel.canChooseDirectories=false;panel.beginSheetModal(for:window){result in completionHandler(result == .OK ? panel.urls:nil)}}
}
let application=NSApplication.shared;let delegate=AppDelegate();application.delegate=delegate;application.setActivationPolicy(.regular);application.run()
`;
fs.writeFileSync(path.join(out,'Host.swift'),swift.replace(/\\u([0-9a-f]{4})/gi,(_,hex:string)=>String.fromCharCode(parseInt(hex,16))));
execFileSync('swiftc',['-O','-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macosx13.0`,'-framework','AppKit','-framework','WebKit',path.join(out,'Host.swift'),'-o',path.join(macos,'ContentDesk')],{stdio:'inherit'});
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>Content Desk</string><key>CFBundleDisplayName</key><string>Content Desk</string><key>CFBundleIdentifier</key><string>studio.contentdesk.community</string><key>CFBundleExecutable</key><string>ContentDesk</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>CFBundleVersion</key><string>2</string><key>CFBundleIconFile</key><string>AppIcon</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>`;
fs.writeFileSync(path.join(contents,'Info.plist'),plist);
execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
console.log('Built '+app+' (ad-hoc signed, not notarized)');
