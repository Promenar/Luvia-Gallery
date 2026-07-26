import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GalleryNavigationController,
  type GalleryNavigationControllerOptions,
  type LocationUpdate,
  type NavigationWriteMode,
} from '../navigation/navigation-controller';
import type {
  GalleryLocation,
  ViewportRestoreCommand,
  ViewportSnapshot,
  ViewportSnapshotInput,
} from '../navigation/types';

export interface UseGalleryNavigationOptions extends GalleryNavigationControllerOptions {
  controller?: GalleryNavigationController;
}

export interface GalleryNavigationApi {
  location: GalleryLocation;
  canGoBack: boolean;
  canGoForward: boolean;
  restoreSnapshot?: ViewportSnapshot;
  restoreCommand?: ViewportRestoreCommand;
  currentSnapshot?: ViewportSnapshot;
  back: () => boolean;
  forward: () => boolean;
  up: () => GalleryLocation | undefined;
  navigate: (location: GalleryLocation, mode?: NavigationWriteMode) => GalleryLocation;
  navigatePath: (folderPath: string) => GalleryLocation;
  updateLocation: (update: LocationUpdate, mode?: NavigationWriteMode) => GalleryLocation;
  captureSnapshot: (snapshot: ViewportSnapshotInput) => ViewportSnapshot | undefined;
  captureImmediateSnapshot: (snapshot: ViewportSnapshotInput) => ViewportSnapshot | undefined;
  requestRestore: (snapshot: ViewportSnapshotInput) => ViewportSnapshot | undefined;
  consumeRestoreSnapshot: (token: number) => void;
  getSnapshot: (locationKey?: string) => ViewportSnapshot | undefined;
}

export const useGalleryNavigation = (options: UseGalleryNavigationOptions = {}): GalleryNavigationApi => {
  const controllerRef = useRef<GalleryNavigationController>();
  if (!controllerRef.current) controllerRef.current = options.controller ?? new GalleryNavigationController(options);
  const controller = controllerRef.current;
  const [location, setLocation] = useState<GalleryLocation>(() => controller.initialize());
  const [historyVersion, setHistoryVersion] = useState(0);
  const [restoreCommand, setRestoreCommand] = useState<ViewportRestoreCommand | undefined>(() => {
    const snapshot = controller.getSnapshot(controller.getLocation().key);
    return snapshot
      ? { token: 0, entryId: controller.getCurrentEntryIdentity(), snapshot }
      : undefined;
  });
  const publishedSnapshotRef = useRef<ViewportSnapshot | undefined>(restoreCommand?.snapshot);
  const restoreCommandTokenRef = useRef(restoreCommand?.token ?? 0);
  const locationRef = useRef(location);
  const restoreSnapshot = restoreCommand?.snapshot;

  const publishRestoreCommand = useCallback((
    snapshot: ViewportSnapshot | undefined,
    entryId: string,
  ) => {
    publishedSnapshotRef.current = snapshot;
    restoreCommandTokenRef.current += 1;
    setRestoreCommand({
      token: restoreCommandTokenRef.current,
      entryId,
      snapshot,
    });
  }, []);

  const syncLocation = useCallback((nextLocation: GalleryLocation, publishRestore = true) => {
    const locationChanged = locationRef.current.key !== nextLocation.key;
    locationRef.current = nextLocation;
    setLocation(nextLocation);
    if (locationChanged && publishRestore) {
      // 跨位置即使两侧都没有快照，也必须发出 reset，不能让旧视口位置残留。
      publishRestoreCommand(controller.getSnapshot(nextLocation.key), controller.getCurrentEntryIdentity());
    }
    setHistoryVersion((version) => version + 1);
    return nextLocation;
  }, [controller, publishRestoreCommand]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const nextLocation = controller.applyPopState(event.state);
      syncLocation(nextLocation, false);
      // 每次 popstate 都是独立的恢复命令：即使路径和 capturedAt 相同也不能去重。
      publishRestoreCommand(
        controller.getSnapshot(nextLocation.key),
        controller.getCurrentEntryIdentity(),
      );
    };
    const onPageHide = () => controller.flush();
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      controller.flush();
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [controller, publishRestoreCommand, syncLocation]);

  const apply = useCallback((action: () => GalleryLocation) => syncLocation(action()), [syncLocation]);
  const back = useCallback(() => controller.back(), [controller]);
  const forward = useCallback(() => controller.forward(), [controller]);
  const up = useCallback(() => {
    const nextLocation = controller.up();
    return nextLocation ? syncLocation(nextLocation) : undefined;
  }, [controller, syncLocation]);
  const captureSnapshot = useCallback((snapshot: ViewportSnapshotInput) => {
    return controller.captureSnapshot(snapshot);
  }, [controller]);
  const captureImmediateSnapshot = useCallback((snapshot: ViewportSnapshotInput) => {
    return controller.captureImmediateSnapshot(snapshot);
  }, [controller]);
  const requestRestore = useCallback((snapshot: ViewportSnapshotInput) => {
    const nextSnapshot = controller.captureSnapshot(snapshot);
    if (nextSnapshot) {
      publishRestoreCommand(nextSnapshot, controller.getCurrentEntryIdentity());
    }
    return nextSnapshot;
  }, [controller, publishRestoreCommand]);
  const consumeRestoreSnapshot = useCallback((token: number) => {
    setRestoreCommand((current) => {
      if (!current || current.token !== token) return current;
      publishedSnapshotRef.current = undefined;
      return undefined;
    });
  }, []);

  return {
    location,
    canGoBack: controller.canGoBack(),
    canGoForward: controller.canGoForward(),
    restoreSnapshot,
    restoreCommand,
    currentSnapshot: restoreSnapshot,
    back,
    forward,
    up,
    navigate: useCallback((nextLocation, mode) => apply(() => controller.navigate(nextLocation, mode)), [apply, controller]),
    navigatePath: useCallback((folderPath) => apply(() => controller.navigatePath(folderPath)), [apply, controller]),
    updateLocation: useCallback((update, mode) => apply(() => controller.updateLocation(update, mode)), [apply, controller]),
    captureSnapshot,
    captureImmediateSnapshot,
    requestRestore,
    consumeRestoreSnapshot,
    getSnapshot: useCallback((locationKey) => controller.getSnapshot(locationKey), [controller]),
  };
};
