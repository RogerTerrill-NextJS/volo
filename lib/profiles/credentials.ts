export type CredentialField='certificates'|'ratings';

export const credentialLabels:Record<CredentialField,readonly string[]>={
 certificates:[
  'PPL-Private Pilot',
  'SPT-Sports Pilot',
  'RPL-Recreational Pilot',
  'CPL-Commercial Pilot',
  'ATP-Airline Transport Pilot',
  'CFI-Certified Flight Instructor',
  'CFII-Certified Flight Instructor instrument',
 ],
 ratings:['MEI-Multi-Engine Instructor','IR-Instrument Rating','RH-Rotor Craft Helicopter','AMEL-Airplane Multi-Engine Land'],
};

const aliases:Record<CredentialField,Record<string,string>>={
 certificates:{'private pilot':'PPL','sport pilot':'SPT','sports pilot':'SPT','recreational pilot':'RPL','commercial pilot':'CPL','airline transport pilot':'ATP','certified flight instructor':'CFI','certified flight instructor instrument':'CFII'},
 ratings:{'multi-engine instructor':'MEI','instrument':'IR','instrument rating':'IR','rotor craft helicopter':'RH'},
};

/** Known aliases select the matching option; unknown labels stay visible/removable. */
export function credentialOptions(field:CredentialField,saved:readonly string[]){
 const labels=credentialLabels[field];
 const selected=new Set(saved.map(value=>value.trim()).filter(Boolean).map(value=>{
  const normalized=value.toLowerCase();
  const code=Object.hasOwn(aliases[field],normalized)?aliases[field][normalized]:normalized;
  return labels.find(label=>label.toLowerCase()===normalized||label.split('-')[0].toLowerCase()===code.toLowerCase())??value;
 }));
 return [...labels,...[...selected].filter(value=>!labels.includes(value))].map(value=>({value,checked:selected.has(value),legacy:!labels.includes(value)}));
}
