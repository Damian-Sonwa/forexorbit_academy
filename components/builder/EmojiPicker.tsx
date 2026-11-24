/**
 * A small emoji panel for lesson text. Emoji are ordinary characters, so they need no format of
 * their own and reach students exactly as typed. Escape or a click outside closes it.
 */

import { useEffect, useRef, useState } from 'react';

const GROUPS: Array<[string, string]> = [
  ['Trading', '📈 📉 📊 💹 💱 💵 💶 💷 💴 💰 🏦 ⚖️ 🎯 🧮 📰 🌍 ⏰ 🕯️'],
  ['Reactions', '👍 👎 👏 🙌 🔥 ⭐ 🌟 🎉 💯 ❤️ 💪 🙏 🤝 👀 🚀 🏆 ✨ 🥇'],
  ['Faces', '😀 😃 😄 🙂 😉 😊 😍 🤔 😎 😮 😅 😬 😢 😡 🥳 🤓 😴 🤯'],
  ['Study', '💡 📚 📖 📝 ✏️ 📌 📎 🧠 🎓 🔍 🗒️ 📅 🧩 🛠️ 🔑 🗂️ 🔔 🏁'],
  ['Signs', '✅ ❌ ⚠️ ❗ ❓ ℹ️ 🚫 ⛔ 🔴 🟠 🟡 🟢 🔵 ➡️ ⬅️ ⬆️ ⬇️ 🔁'],
];

export default function EmojiPicker({ onPick, onClose, className = '' }: { onPick: (emoji: string) => void; onClose: () => void; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [group, setGroup] = useState(0);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) close.current(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <div ref={box} role="dialog" aria-label="Insert an emoji" className={`absolute z-20 w-[min(20rem,calc(100vw-3rem))] rounded-2xl border border-line bg-surface-1 p-2.5 shadow-lift ${className}`} data-testid="emoji-picker">
      <div className="flex flex-wrap gap-0.5" role="group" aria-label="Emoji groups">
        {GROUPS.map(([name], i) => (
          <button key={name} type="button" aria-pressed={i === group} onClick={() => setGroup(i)} className={`min-h-[2.25rem] shrink-0 rounded-lg px-2 text-xs font-semibold ${i === group ? 'bg-tint text-ink' : 'text-ink-muted hover:text-ink'}`}>{name}</button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-6 gap-0.5">
        {GROUPS[group][1].split(' ').map((emoji) => (
          <button key={emoji} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(emoji)} className="flex h-11 items-center justify-center rounded-lg text-xl hover:bg-tint" aria-label={`Insert ${emoji}`}>{emoji}</button>
        ))}
      </div>
    </div>
  );
}
