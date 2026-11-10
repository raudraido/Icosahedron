import { useState } from "react";
import { useStore } from "../store";
import { useAvatar, setMyAvatar, removeMyAvatar, pickImage } from "../lib/avatar";
import { useSync, notify } from "../lib/sync";
import { ContextMenu } from "./ContextMenu";

/** A round profile picture, or the first letter of the name on the accent color. */
export function Avatar({ user, size = 28 }: { user: string; size?: number }) {
  const url = useAvatar(user);
  return url ? (
    <img src={url} alt="" draggable={false} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
  ) : (
    <div
      aria-hidden
      style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0, background: "var(--accent)", color: "white",
        display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: Math.round(size * 0.5), lineHeight: 1,
      }}
    >
      {(user.trim()[0] ?? "?").toUpperCase()}
    </div>
  );
}

/** Lets the user pick a new picture; a failure is shown as a short notice. */
export async function changeMyPicture() {
  const f = await pickImage();
  if (!f) return;
  try { await setMyAvatar(f); } catch (e) { notify((e as Error).message); }
}

/** Always-visible "who is signed in" button (queue panel header): click for the picture menu. */
export function ProfileButton() {
  const username = useStore((s) => s.username);
  const navigateTo = useStore((s) => s.navigateTo);
  const hasSync = useSync((s) => !!s.syncUrl);
  const mine = useAvatar(username);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  if (!username) return null;

  return (
    <>
      <button
        title={username}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPos({ x: r.right - 200, y: r.bottom + 6 }); }}
        style={{ marginLeft: 6, padding: 0, border: "none", background: "transparent", cursor: "pointer", display: "flex", flexShrink: 0 }}
      >
        <Avatar user={username} size={30} />
      </button>
      {pos && (
        <ContextMenu
          x={pos.x}
          y={pos.y}
          onClose={() => setPos(null)}
          items={[
            { label: username, subtitle: hasSync ? undefined : "Picture needs a sync server", disabled: true },
            "separator",
            { label: mine ? "Change photo" : "Add photo", disabled: !hasSync, onClick: () => void changeMyPicture() },
            ...(mine ? [{ label: "Remove photo", onClick: () => void removeMyAvatar() }] : []),
            "separator",
            { label: "Settings", icon: "img/settings.png", onClick: () => navigateTo({ tab: "settings" }) },
          ]}
        />
      )}
    </>
  );
}
