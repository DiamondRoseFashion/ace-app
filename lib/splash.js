// The opening animation (components/Splash.js) plays:
//  • right after you log in (playSplash, called by the login page), and
//  • when ACE is opened while you're already logged in (once per tab).
// Never on the login screen itself. Devices with animations turned off get
// a still version (no movement). SPLASH_SCRIPT runs in <head>, before
// anything is drawn, so it never flashes up when it shouldn't.
export const SPLASH_SEEN_KEY = 'ace-splash-seen';

export const SPLASH_SCRIPT = `(function(){try{var d=document.documentElement;if(location.pathname.indexOf('/login')===0||location.pathname==='/'||sessionStorage.getItem('${SPLASH_SEEN_KEY}')){d.setAttribute('data-splash','skip');}else{sessionStorage.setItem('${SPLASH_SEEN_KEY}','1');d.setAttribute('data-splash','show');}}catch(e){document.documentElement.setAttribute('data-splash','skip');}})();`;

// Just logged in: play it now (the app opens underneath)
export function playSplash() {
  try { window.sessionStorage.setItem(SPLASH_SEEN_KEY, '1'); } catch { /* ignore */ }
  document.documentElement.setAttribute('data-splash', 'show');
  window.dispatchEvent(new Event('ace-splash-show'));
}
