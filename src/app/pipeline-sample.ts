/** A normalized selection survives changes in preview resolution and stays fully inside the buffer. */
export function pipelineSample(width:number,height:number,x:number,y:number,size=16) {
  const w=Math.min(size,width),h=Math.min(size,height);
  const px=Number.isFinite(x)?x:.5,py=Number.isFinite(y)?y:.5;
  return {x:Math.max(0,Math.min(width-w,Math.round(px*width-w/2))),y:Math.max(0,Math.min(height-h,Math.round(py*height-h/2))),width:w,height:h};
}
