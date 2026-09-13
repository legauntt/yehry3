// Guide content arrives only from the authenticated endpoint; this file holds UI behavior.
export function mountGuide(root, { body, stages, examplePlan }) {
  if (typeof body !== 'string' || !Array.isArray(stages) || stages.length !== 6 || !examplePlan?.plan) throw new Error('The guide could not be loaded. Please try again.');
  const parsed = new DOMParser().parseFromString(body, 'text/html');
  // The fragment is maintained in the private backend. It never supplies executable content.
  if (parsed.querySelector('script,style,iframe,object,embed,form,link,base,meta,svg,math')) throw new Error('The guide contains unsupported markup.');
  for (const element of parsed.body.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      if (/^on/i.test(attribute.name) || ['style','srcdoc'].includes(attribute.name)) throw new Error('The guide contains unsupported attributes.');
      if (['href','src'].includes(attribute.name) && !/^(?:#|\/(?!\/)|https:\/\/)/i.test(attribute.value)) throw new Error('The guide contains an unsupported link.');
    }
  }
  root.replaceChildren(...parsed.body.childNodes);
  const get = id => root.querySelector('#'+id);
  let selected = 0;
  const buttons = [...root.querySelectorAll('.step-button')];
  function selectStage(index) {
    selected = index;
    const stage = stages[index];
    for (const key of ['title','main','body','input','output','note']) get('panel-'+key).textContent = stage[key];
    get('panel-count').textContent = 'STAGE '+String(index+1).padStart(2,'0')+' / 06';
    get('panel-location').textContent = stage.location;
    get('panel-location').className = 'location-tag '+(['hosted','local'].includes(stage.tone) ? stage.tone : '');
    const source = new URL(stage.source);
    if (source.protocol !== 'https:') throw new Error('Invalid guide source.');
    get('panel-source').href = source.href;
    get('panel-source').textContent = stage.sourceLabel+' ↗';
    buttons.forEach((button,i) => button.setAttribute('aria-pressed',String(i===index)));
    get('next-stage').textContent = index===5 ? 'Back to the beginning ↺' : 'Next stage →';
  }
  buttons.forEach((button,index) => button.addEventListener('click', () => selectStage(index)));
  get('next-stage').addEventListener('click', () => selectStage((selected+1)%stages.length));
  const download = URL.createObjectURL(new Blob([JSON.stringify(examplePlan,null,2)+'\n'], {type:'application/json'}));
  get('download-plan').href = download;
  let printSections;
  let previouslyOpen;
  function beforePrint() {
    if (printSections) return;
    printSections = document.createElement('div');
    stages.forEach((stage,index) => {
      const section = document.createElement('article'); section.className = 'print-stage';
      const heading = document.createElement('h3'); heading.textContent = (index+1)+'. '+stage.title; section.append(heading);
      for (const key of ['main','body','note']) { const p=document.createElement('p'); p.textContent=stage[key]; section.append(p); }
      printSections.append(section);
    });
    root.querySelector('.journey').hidden = true;
    root.querySelector('.journey').after(printSections);
    previouslyOpen = [...root.querySelectorAll('details')].map(detail => detail.open);
    root.querySelectorAll('details').forEach(detail => { detail.open = true; });
  }
  function afterPrint() {
    if (!printSections) return;
    printSections.remove(); printSections = null;
    root.querySelector('.journey').hidden = false;
    root.querySelectorAll('details').forEach((detail,index) => { detail.open = previouslyOpen[index]; });
  }
  window.addEventListener('beforeprint',beforePrint);
  window.addEventListener('afterprint',afterPrint);
  return () => {
    window.removeEventListener('beforeprint',beforePrint);
    window.removeEventListener('afterprint',afterPrint);
    URL.revokeObjectURL(download);
  };
}
