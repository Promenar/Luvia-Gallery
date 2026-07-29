import Foundation
import XCTest
@testable import DisplayPlacementCore

final class DisplayPlacementCoreTests: XCTestCase {
    func testRestoresRelativePositionWhenGlobalOriginChanges() throws {
        let originalVisibleFrame = CGRect(x: -1440, y: 24, width: 1440, height: 876)
        let originalFrame = CGRect(x: -1080, y: 600, width: 480, height: 240)
        let placement = DisplayPlacement(globalFrame: originalFrame, visibleFrame: originalVisibleFrame)

        let movedVisibleFrame = CGRect(x: 0, y: 24, width: 1440, height: 876)
        XCTAssertEqual(
            try XCTUnwrap(placement.restoredFrame(in: movedVisibleFrame)),
            CGRect(x: 360, y: 600, width: 480, height: 240)
        )
    }

    func testRestoresIntoChangedVisibleFrameWithTopRelativePosition() throws {
        let placement = DisplayPlacement(
            globalFrame: CGRect(x: 200, y: 500, width: 400, height: 200),
            visibleFrame: CGRect(x: 0, y: 0, width: 1000, height: 800)
        )

        XCTAssertEqual(
            try XCTUnwrap(placement.restoredFrame(in: CGRect(x: 2000, y: 30, width: 800, height: 500))),
            CGRect(x: 2133.3333333333335, y: 280, width: 400, height: 200)
        )
    }

    func testNormalizesInvalidRatiosAndClampsOversizedWindow() throws {
        let placement = DisplayPlacement(xRatio: .infinity, topRatio: -2, width: 4_000, height: .nan)

        XCTAssertEqual(
            try XCTUnwrap(placement.restoredFrame(in: CGRect(x: 10, y: 20, width: 300, height: 200))),
            CGRect(x: 10, y: 219, width: 300, height: 1)
        )
    }

    func testStoreKeepsPlacementsSeparatedByPhysicalDisplayKey() {
        let defaults = makeDefaults()
        let store = DisplayPlacementStore(defaults: defaults)
        let first = DisplayPlacement(xRatio: 0.1, topRatio: 0.2, width: 300, height: 200)
        let second = DisplayPlacement(xRatio: 0.8, topRatio: 0.7, width: 500, height: 400)

        store.save(first, for: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")
        store.save(second, for: "11111111-2222-3333-4444-555555555555")

        XCTAssertEqual(store.placement(for: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"), first)
        XCTAssertEqual(store.placement(for: "11111111-2222-3333-4444-555555555555"), second)
    }

    func testCodableRoundTripAndIgnoresDamagedData() throws {
        let placement = DisplayPlacement(xRatio: 0.25, topRatio: 0.75, width: 420, height: 260)
        let restored = try JSONDecoder().decode(DisplayPlacement.self, from: JSONEncoder().encode(placement))
        XCTAssertEqual(restored, placement)

        let defaults = makeDefaults()
        defaults.set(["display": Data("not-json".utf8)], forKey: DisplayPlacementStore.storageKey)
        XCTAssertNil(DisplayPlacementStore(defaults: defaults).placement(for: "display"))
    }

    func testBuiltInFingerprintDoesNotDependOnTransientDisplayID() {
        let identity = DisplayPhysicalIdentity(
            isBuiltIn: true,
            vendorID: 1552,
            modelID: 42,
            serialNumber: 0,
            localizedName: "MacBook Pro 显示器",
            physicalSizeMillimeters: CGSize(width: 345, height: 224)
        )
        let reconnectWithDifferentTransientID = DisplayPhysicalIdentity(
            isBuiltIn: true,
            vendorID: 1552,
            modelID: 42,
            serialNumber: 0,
            localizedName: "Built-in Retina Display",
            physicalSizeMillimeters: CGSize(width: 1, height: 1)
        )

        XCTAssertTrue(identity.fingerprint.hasPrefix("display-v2|builtin|"))
        XCTAssertEqual(identity.fingerprint, reconnectWithDifferentTransientID.fingerprint)
    }

    func testExternalNonzeroSerialFingerprintUsesPhysicalSerial() {
        let first = DisplayPhysicalIdentity(
            isBuiltIn: false,
            vendorID: 4268,
            modelID: 123,
            serialNumber: 987_654,
            localizedName: "Studio Display",
            physicalSizeMillimeters: CGSize(width: 600, height: 340)
        )
        let changedNameAndSize = DisplayPhysicalIdentity(
            isBuiltIn: false,
            vendorID: 4268,
            modelID: 123,
            serialNumber: 987_654,
            localizedName: "不同的临时名称",
            physicalSizeMillimeters: CGSize(width: 1, height: 1)
        )

        XCTAssertEqual(first.fingerprint, changedNameAndSize.fingerprint)
        XCTAssertTrue(first.fingerprint.contains("serial:987654"))
    }

    func testExternalZeroSerialFingerprintFallsBackToVendorModelNameAndPhysicalSize() {
        let first = DisplayPhysicalIdentity(
            isBuiltIn: false,
            vendorID: 4268,
            modelID: 123,
            serialNumber: 0,
            localizedName: "Dell U2723QE",
            physicalSizeMillimeters: CGSize(width: 614.4, height: 345.6)
        )
        let differentSize = DisplayPhysicalIdentity(
            isBuiltIn: false,
            vendorID: 4268,
            modelID: 123,
            serialNumber: 0,
            localizedName: "Dell U2723QE",
            physicalSizeMillimeters: CGSize(width: 600, height: 340)
        )

        XCTAssertNotEqual(first.fingerprint, differentSize.fingerprint)
        XCTAssertTrue(first.fingerprint.contains("name:dell u2723qe"))
        XCTAssertTrue(first.fingerprint.contains("size:6144x3456"))
    }

    func testFingerprintCollisionUsesSessionKeyWithoutPersisting() {
        let identity = DisplayPhysicalIdentity(
            isBuiltIn: false,
            vendorID: 1,
            modelID: 2,
            serialNumber: 0,
            localizedName: "重复显示器",
            physicalSizeMillimeters: CGSize(width: 600, height: 340)
        )
        var resolver = DisplayPlacementKeyResolver(sessionKeyFactory: { "session-random" })
        let key = resolver.resolve(
            identity: identity,
            connectionID: "transient-200",
            connectedFingerprints: [identity.fingerprint, identity.fingerprint]
        )
        let defaults = makeDefaults()
        let store = DisplayPlacementStore(defaults: defaults)
        let placement = DisplayPlacement(xRatio: 0.2, topRatio: 0.3, width: 400, height: 200)

        XCTAssertFalse(key.isPersistent)
        store.save(placement, for: key)
        XCTAssertEqual(store.placement(for: key), placement)
        XCTAssertNil(defaults.object(forKey: DisplayPlacementStore.storageKey))
    }

    func testUntrustedPhysicalIdentityAlwaysUsesSessionKeyWithoutPersisting() {
        let identity = DisplayPhysicalIdentity(
            isBuiltIn: false,
            vendorID: 0,
            modelID: 0,
            serialNumber: 0,
            localizedName: " ",
            physicalSizeMillimeters: CGSize(width: 0, height: 0)
        )
        var resolver = DisplayPlacementKeyResolver(sessionKeyFactory: { "session-untrusted" })
        let key = resolver.resolve(
            identity: identity,
            connectionID: "transient-300",
            connectedFingerprints: [identity.fingerprint]
        )
        let defaults = makeDefaults()
        let store = DisplayPlacementStore(defaults: defaults)

        XCTAssertFalse(identity.isPersistable)
        XCTAssertFalse(key.isPersistent)
        store.save(DisplayPlacement(xRatio: 0, topRatio: 0, width: 200, height: 100), for: key)
        XCTAssertNil(defaults.object(forKey: DisplayPlacementStore.storageKey))
    }

    func testPartialVendorOrModelIdentityAlwaysUsesSessionKey() {
        let incompleteIdentities = [
            DisplayPhysicalIdentity(
                isBuiltIn: false,
                vendorID: 0,
                modelID: 42,
                serialNumber: 900,
                localizedName: "外接屏",
                physicalSizeMillimeters: CGSize(width: 600, height: 340)
            ),
            DisplayPhysicalIdentity(
                isBuiltIn: false,
                vendorID: 42,
                modelID: 0,
                serialNumber: 900,
                localizedName: "外接屏",
                physicalSizeMillimeters: CGSize(width: 600, height: 340)
            )
        ]

        for (index, identity) in incompleteIdentities.enumerated() {
            var resolver = DisplayPlacementKeyResolver(sessionKeyFactory: { "session-partial-\(index)" })
            let key = resolver.resolve(
                identity: identity,
                connectionID: "partial-\(index)",
                connectedFingerprints: [identity.fingerprint]
            )
            XCTAssertFalse(identity.isPersistable)
            XCTAssertFalse(key.isPersistent)
        }
    }

    func testSameFingerprintDifferentConnectionsHaveDistinctSessionPrimaryKeys() {
        let identity = DisplayPhysicalIdentity(
            isBuiltIn: false,
            vendorID: 10,
            modelID: 20,
            serialNumber: 0,
            localizedName: "同型号显示器",
            physicalSizeMillimeters: CGSize(width: 600, height: 340)
        )
        var nextSession = 0
        var resolver = DisplayPlacementKeyResolver(sessionKeyFactory: {
            nextSession += 1
            return "session-\(nextSession)"
        })
        let fingerprints = [identity.fingerprint, identity.fingerprint]
        let firstKey = resolver.resolve(identity: identity, connectionID: "100", connectedFingerprints: fingerprints)
        let secondKey = resolver.resolve(identity: identity, connectionID: "200", connectedFingerprints: fingerprints)
        var primaryState = SystemPrimaryDisplayState()

        XCTAssertNotEqual(firstKey, secondKey)
        XCTAssertTrue(primaryState.shouldRestore(for: firstKey))
        XCTAssertTrue(primaryState.shouldRestore(for: secondKey))
        XCTAssertFalse(primaryState.shouldRestore(for: secondKey))
        XCTAssertEqual(
            resolver.resolve(identity: identity, connectionID: "100", connectedFingerprints: fingerprints),
            firstKey
        )
    }

    func testRejectsInvalidVisibleFrameInsteadOfProducingAnUnsafeFrame() {
        let placement = DisplayPlacement(xRatio: 0.5, topRatio: 0.5, width: 400, height: 200)

        XCTAssertNil(placement.restoredFrame(in: CGRect(x: CGFloat.infinity, y: 0, width: 800, height: 600)))
        XCTAssertNil(placement.restoredFrame(in: CGRect(x: 0, y: 0, width: 0, height: 600)))
    }

    private func makeDefaults() -> UserDefaults {
        let suiteName = "DisplayPlacementCoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }
}
