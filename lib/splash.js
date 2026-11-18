// Decides (in <head>, before anything is drawn) whether the opening
// animation plays: once per browser tab, never for people who turn off
// motion on their device. The animation itself is components/Splash.js.
export const SPLASH_SEEN_KEY = 'ace-splash-seen';

export const SPLASH_SCRIPT = `(function(){try{var d=document.documentElement;if(sessionStorage.getItem('${SPLASH_SEEN_KEY}')||matchMedia('(prefers-reduced-motion: reduce)').matches){d.setAttribute('data-splash','skip');}else{sessionStorage.setItem('${SPLASH_SEEN_KEY}','1');d.setAttribute('data-splash','show');}}catch(e){document.documentElement.setAttribute('data-splash','skip');}})();`;
