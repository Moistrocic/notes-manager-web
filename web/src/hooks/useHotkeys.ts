import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';

/** Global keyboard shortcuts. */
export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true;
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        useAppStore.getState().setPaletteOpen(!useAppStore.getState().paletteOpen);
        return;
      }

      if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void useAppStore.getState().createNote();
        return;
      }

      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void useAppStore.getState().saveActive(true);
        return;
      }

      if (mod && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        const order = ['edit', 'split', 'preview'] as const;
        const current = useAppStore.getState().editorMode;
        useAppStore.getState().setEditorMode(order[(order.indexOf(current) + 1) % order.length]);
        return;
      }

      if (mod && event.key.toLowerCase() === 'b' && !typing) {
        event.preventDefault();
        useAppStore.getState().toggleSidebar();
        return;
      }

      if (event.key === 'Escape' && !typing) {
        const state = useAppStore.getState();
        if (state.paletteOpen) state.setPaletteOpen(false);
        else if (state.settingsOpen) state.setSettingsOpen(false);
        else if (state.trashOpen) state.setTrashOpen(false);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
