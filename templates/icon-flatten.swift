import Cocoa

// icon-flatten.swift — 将 Icon Composer 的 .icon 规格展平为 1024×1024 PNG。
// 用法: swift icon-flatten.swift <icon.json 路径> <输出 png 路径> [画布尺寸]
// .icon 目录结构: icon.json（layers/scale/translation 规格）+ Assets/*.png
// layers 数组为自顶向下顺序，倒序绘制（底层先画）。

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: icon-flatten.swift <icon.json> <out.png> [size]\n".data(using: .utf8)!)
    exit(2)
}

let jsonURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])
let size = CGFloat(args.count > 3 ? (Double(args[3]) ?? 1024) : 1024)

do {
    let data = try Data(contentsOf: jsonURL)
    guard let spec = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let groups = spec["groups"] as? [[String: Any]], let group = groups.first,
          let layers = group["layers"] as? [[String: Any]] else {
        FileHandle.standardError.write("invalid .icon spec: groups/layers missing\n".data(using: .utf8)!)
        exit(1)
    }
    let assetsDir = jsonURL.deletingLastPathComponent().appendingPathComponent("Assets")

    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    NSGraphicsContext.current?.imageInterpolation = .high

    for layer in layers.reversed() {
        guard let name = layer["image-name"] as? String else { continue }
        let url = assetsDir.appendingPathComponent(name)
        guard let ns = NSImage(contentsOf: url) else {
            FileHandle.standardError.write("warn: layer image not found: \(name)\n".data(using: .utf8)!)
            continue
        }
        var scale: CGFloat = 1
        var tx: CGFloat = 0, ty: CGFloat = 0
        if let pos = layer["position"] as? [String: Any] {
            if let s = pos["scale"] as? Double { scale = CGFloat(s) }
            if let t = pos["translation-in-points"] as? [Double], t.count == 2 {
                tx = CGFloat(t[0]); ty = CGFloat(t[1])
            }
        }
        let w = size * scale, h = size * scale
        let rect = NSRect(x: (size - w) / 2 + tx, y: (size - h) / 2 + ty, width: w, height: h)
        ns.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
    }
    image.unlockFocus()

    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write("failed to render PNG\n".data(using: .utf8)!)
        exit(1)
    }
    try png.write(to: outURL)
} catch {
    FileHandle.standardError.write("error: \(error.localizedDescription)\n".data(using: .utf8)!)
    exit(1)
}
