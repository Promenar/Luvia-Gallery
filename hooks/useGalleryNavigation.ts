import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GalleryNavigationController,
  type GalleryNavigationControllerOptions,
  type LocationUpdate,
  type NavigationWriteMode,
} from '../navigation/navigation-controller';
import type { GalleryLocation, ViewportSnapshot } from '../navigation/types';

export interface UseGalleryNavigationOptions extends GalleryNavigationControllerOptions {
  controller?: GalleryNavigationController;
}

export interface GalleryNavigationApi {
  location: GalleryLocation;
  canGoBack: boolean;
  canGoForward: boolean;
  restoreSnapshot?: ViewportSnapshot;
  currentSnapshot?: ViewportSnapshot;
  back: () => boolean;
  forward: () => boolean;
  up: () => GalleryLocation | undefined;
  navigate: (location: GalleryLocation, mode?: NavigationWriteMode) => GalleryLocation;
  navigatePath: (folderPath: string) => GalleryLocation;
  updateLocation: (update: LocationUpdate, mode?: NavigationWriteMode) => GalleryLocation;
  captureSnapshot: (snapshot: Omit<ViewportSnapshot, 'locationKey' | 'capturedAt'> & Partial<Pick<ViewportSnapshot, 'capturedAt'>>) => ViewportSnapshot;
  requestRestore: (snapshot: Omit<ViewportSnapshot, 'locationKey' | 'capturedAt'> & Partial<Pick<ViewportSnapshot, 'capturedAt'>>) => ViewportSnapshot;
  consumeRestoreSnapshot: () => void;
  getSnapshot: (locationKey?: string) => ViewportSnapshot | undefined;
}

const hasSameSnapshotVersion = (left: ViewportSnapshot | undefined, right: ViewportSnapshot | undefined): boolean =>
  left === right || (left?.locationKey === right?.locationKey && left?.capturedAt === right?.capturedAt);

export const useGalleryNavigation = (options: UseGalleryNavigationOptions = {}): GalleryNavigationApi => {
  const controllerRef = useRef<GalleryNavigationController>();
  if (!controllerRef.current) controllerRef.current = options.controller ?? new GalleryNavigationController(options);
  const controller = controllerRef.current;
  const [location, setLocation] = useState<GalleryLocation>(() => controller.initialize());
  const [historyVersion, setHistoryVersion] = useState(0);
  const [restoreSnapshot, setRestoreSnapshot] = useState<ViewportSnapshot | undefined>(() =>
    controller.getSnapshot(controller.getLocation().key)
  );
  const publishedSnapshotRef = useRef<ViewportSnapshot | undefined>(restoreSnapshot);
  const locationRef = useRef(location);

  const publishRestoreSnapshot = useCallback((snapshot: ViewportSnapshot | undefined) => {
    if (hasSameSnapshotVersion(publishedSnapshotRef.current, snapshot)) return;
    publishedSnapshotRef.current = snapshot;
    setRestoreSnapshot(snapshot);
  }, []);

  const syncLocation = useCallback((nextLocation: GalleryLocation) => {
    const locationChanged = locationRef.current.key !== nextLocation.key;
    locationRef.current = nextLocation;
    setLocation(nextLocation);
    if (locationChanged) publishRestoreSnapshot(controller.getSnapshot(nextLocation.key));
    setHistoryVersion((version) => version + 1);
    return nextLocation;
  }, [controller, publishRestoreSnapshot]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => syncLocation(controller.applyPopState(event.state));
    const onPageHide = () => controller.flush();
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      controller.flush();
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [controller, syncLocation]);

  const apply = useCallback((action: () => GalleryLocation) => syncLocation(action()), [syncLocation]);
  const back = useCallback(() => controller.back(), [controller]);
  const forward = useCallback(() => controller.forward(), [controller]);
  const up = useCallback(() => {
    const nextLocation = controller.up();
    return nextLocation ? syncLocation(nextLocation) : undefined;
  }, [controller, syncLocation]);
  const captureSnapshot = useCallback((snapshot: Omit<ViewportSnapshot, 'locationKey' | 'capturedAt'> & Partial<Pick<ViewportSnapshot, 'capturedAt'>>) => {
    return controller.captureSnapshot(snapshot);
  }, [controller]);
  const requestRestore = useCallback((snapshot: Omit<ViewportSnapshot, 'locationKey' | 'capturedAt'> & Partial<Pick<ViewportSnapshot, 'capturedAt'>>) => {
    const nextSnapshot = controller.captureSnapshot(snapshot);
    publishRestoreSnapshot(nextSnapshot);
    return nextSnapshot;
  }, [controller, publishRestoreSnapshot]);
  const consumeRestoreSnapshot = useCallback(() => publishRestoreSnapshot(undefined), [publishRestoreSnapshot]);

  return {
    location,
    canGoBack: controller.canGoBack(),
    canGoForward: controller.canGoForward(),
    restoreSnapshot,
    currentSnapshot: restoreSnapshot,
    back,
    forward,
    up,
    navigate: useCallback((nextLocation, mode) => apply(() => controller.navigate(nextLocation, mode)), [apply, controller]),
    navigatePath: useCallback((folderPath) => apply(() => controller.navigatePath(folderPath)), [apply, controller]),
    updateLocation: useCallback((update, mode) => apply(() => controller.updateLocation(update, mode)), [apply, controller]),
    captureSnapshot,
    requestRestore,
    consumeRestoreSnapshot,
    getSnapshot: useCallback((locationKey) => controller.getSnapshot(locationKey), [controller]),
  };
};
