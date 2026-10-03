import type { Store } from './store';
import '../styles/shot-launch.css';
export function mountShotLauncher(store:Store) {
  const button=document.createElement('button');button.className='btn shot-launch';button.textContent='▶ Play the shot';button.type='button';
  document.getElementById('view')!.append(button);
  const menu=document.createElement('button');menu.className='btn';menu.textContent='Play the shot';menu.type='button';document.getElementById('studio-actions')!.append(menu);
  let show:((source:HTMLElement)=>void)|undefined;
  async function open(source:HTMLButtonElement){source.disabled=true;const label=source.textContent;source.textContent='Opening…';
    try{show??=(await import('./shot-player')).createShotPlayer(store);show(source);document.querySelector<HTMLDetailsElement>('.view-menu')?.removeAttribute('open');}
    catch{source.textContent='Try Play the shot again';}
    finally{source.disabled=false;if(show)source.textContent=label;}
  }
  button.onclick=()=>void open(button);menu.onclick=()=>void open(menu);
  store.subscribe(state=>button.hidden=state.piece!=='camera');button.hidden=store.get().piece!=='camera';
}
