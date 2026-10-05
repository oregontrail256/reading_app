// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ReaderCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "ReaderCore", targets: ["ReaderCore"])],
    targets: [
        .target(name: "ReaderCore"),
        .testTarget(name: "ReaderCoreTests", dependencies: ["ReaderCore"], resources: [.copy("Fixtures")]),
    ]
)
