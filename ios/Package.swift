// swift-tools-version:5.9
// plus-one 的 iOS 零件：一个「一起看」视图，传网址就能用。
// 网页里跑的芯（core.js）和大管家（butler.bundle.js）都是电脑版那一份 JavaScript，
// 由 node tools/build-ios-bundle.js 从 core/ 和 butler/ 生成进 Resources。
import PackageDescription

let package = Package(
    name: "PlusOne",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "PlusOne", targets: ["PlusOne"]),
    ],
    targets: [
        .target(
            name: "PlusOne",
            resources: [
                .copy("Resources/butler.bundle.js"),
                .copy("Resources/core.js"),
                .copy("Resources/frame-shim.js"),
            ]
        ),
        .testTarget(name: "PlusOneTests", dependencies: ["PlusOne"]),
    ]
)
