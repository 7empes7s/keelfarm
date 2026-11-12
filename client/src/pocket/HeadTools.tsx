// Pocket mode's top bar buttons between the company's name and the CEO chat (#588): 🔍, 🔔, sound, CC, full screen, ⓘ
// and Chat mode, in headBar.ts's order. Wide, all but 🔔 also sit in one ⋯ that desktop.css shows, and the buttons
// hide, when the bar is narrow, so nothing wraps and each stays one tap away.
import { useState, useSyncExternalStore } from 'react';
import { SearchButton } from '../ui/SearchPalette';
import { openSearch } from '../ui/goTo';
import { NoticeBell } from '../ui/Notices';
import { BrowserFullButton } from '../ui/BrowserFullButton';
import { canGoFullscreen, toggleBrowserFull, useBrowserFull } from '../ui/browserFull';
import { QuickToggles, tap } from '../ui/QuickToggles';
import { getAudioPrefs, subscribeAudio } from '../ui/sfx';
import { useA11y } from '../ui/a11y';
import { InfoButton, InfoSheet } from '../ui/InfoButton';
import { useChatMode } from '../ui/chatMode';
import { Menu } from '../ui/Menu';
import { Icon } from '../ui/Icon';
import type { ScreenId } from '../ui/screenHelp';
import { headMore, headTools, type HeadTool } from './headBar';
import type { PocketTab } from './pocketData';
import './headBar.css';

export function HeadTools({ wide, tab, help }: { wide: boolean; tab: PocketTab; help: ScreenId | undefined }) {
  const chatMode = useChatMode();
  const muted = useSyncExternalStore(subscribeAudio, () => getAudioPrefs().muted);
  const captions = useA11y((s) => s.prefs.captions);
  const browserFull = useBrowserFull();
  const [info, setInfo] = useState(false);
  const tools = headTools({ wide, tab, canFull: canGoFullscreen() });
  const cls = (t: HeadTool) => `pk-icon-btn ${tools.find((x) => x.tool === t)?.fold ? 'pk-fold' : ''}`;
  const has = (t: HeadTool) => tools.some((x) => x.tool === t);
  const act: Partial<Record<HeadTool, () => void>> = {
    search: openSearch,
    sound: () => tap('mute'),
    captions: () => tap('captions'),
    fullScreen: () => toggleBrowserFull(),
    info: () => setInfo(true),
    chatMode: () => chatMode.set(!chatMode.on),
  };
  const more = headMore(tools, { muted, captions, browserFull, chatMode: chatMode.on });
  return (
    <>
      {has('search') && <SearchButton className={cls('search')} />}
      {has('notifications') && <NoticeBell className={cls('notifications')} compact={!wide} />}
      {/* wide, Sound and CC; on a phone one Sound & captions */}
      {has('sound') && <QuickToggles className={cls('sound')} compact={!wide} />}
      {has('fullScreen') && <BrowserFullButton className={cls('fullScreen')} />}
      {has('info') && help && <InfoButton screen={help} className={cls('info')} />}
      {has('chatMode') && (
        <button className="btn btn-small pk-switch pk-fold" aria-pressed={chatMode.on} onClick={() => chatMode.set(!chatMode.on)} title={`Chat mode (#120): agents' windows open on their ${chatMode.on ? 'chat' : 'terminal'}. Click to switch`}>
          <Icon name="message-circle" /> Chat {chatMode.on ? 'on' : 'off'}
        </button>
      )}
      {more.length > 0 && <Menu label="More in the top bar" title="More" className="pk-head-more" items={more.map((m) => ({ label: m.label, onSelect: () => act[m.tool]?.() }))} />}
      {info && help && <InfoSheet screen={help} onClose={() => setInfo(false)} />}
    </>
  );
}
