import type { Store } from './store';
import type { Example } from './examples';
import { on } from './bus';
import '../styles/shot-launch.css';
export function mountShotLauncher(store:Store) {
  const button=document.createElement('button');button.className='btn shot-launch';button.textContent='▶ Play the shot';button.type='button';
  document.getElementById('view')!.append(button);
  const menu=document.createElement('button');menu.className='btn';menu.textContent='Play the shot';menu.type='button';document.getElementById('studio-actions')!.append(menu);
  let show:((source:HTMLElement,example?:Example)=>void)|undefined;
  let opening=false;
  async function open(source:HTMLElement,example?:Example){if(opening)return;opening=true;button.disabled=menu.disabled=true;const label=source.textContent;source.textContent='Opening…';
    try{show??=(await import('./shot-player')).createShotPlayer(store);show(source,example);document.querySelector<HTMLDetailsElement>('.view-menu')?.removeAttribute('open');}
    catch{source.textContent='Try Play the shot again';}
    finally{opening=false;button.disabled=menu.disabled=false;if(show)source.textContent=label;}
  }
  button.onclick=()=>void open(button);menu.onclick=()=>void open(menu);
  on('play-photo',({example,source})=>void open(source,example));
  store.subscribe(state=>button.hidden=state.piece!=='camera');button.hidden=store.get().piece!=='camera';
}
