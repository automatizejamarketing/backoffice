"use client";

import { useRef, useState } from "react";
import { Check, FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Contact = {id:string;name:string|null;phone:string};
const phoneLabel = (phone:string) => phone.replace(/^55(\d{2})(\d{5})(\d{4})$/, '+55 ($1) $2-$3');

export function WhatsappCampaignTest({campaignId,approved,enabled}:{campaignId:string;approved:boolean;enabled:boolean}) {
  const [open,setOpen] = useState(false);
  const [contacts,setContacts] = useState<Contact[]>([]);
  const [userId,setUserId] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [status,setStatus] = useState('');
  const requestId = useRef<string|null>(null);
  const sending = useRef(false);
  async function show() {
    setOpen(true);setBusy(true);setError('');
    try {
      const response = await fetch('/api/whatsapp/campaigns?testContacts=1',{cache:'no-store'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setContacts(data.contacts);setUserId(current=>data.contacts.some((c:Contact)=>c.id===current)?current:data.contacts[0]?.id??'');
    } catch {setError('Não foi possível carregar os números de teste. Feche e tente novamente.');}
    finally {setBusy(false);}
  }
  async function send() {
    if (sending.current) return;
    sending.current=true;setBusy(true);setError('');
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch('/api/whatsapp/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'sendTest',id:campaignId,data:{userId,requestId:requestId.current}})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error||'Não foi possível enviar o teste.');
      setStatus(data.status);
    } catch(e) {setError(`${(e as Error).message} Se houve uma falha de conexão, confira seu WhatsApp antes de tentar novamente.`);}
    finally {sending.current=false;setBusy(false);}
  }
  return <>
    <Button variant="outline" disabled={!approved||!enabled} onClick={show}><FlaskConical className="size-4"/>Enviar teste</Button>
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}>
      <DialogContent className="w-[calc(100%_-_2rem)] max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle>Enviar mensagem de teste</DialogTitle><DialogDescription>Confira o template aprovado no seu WhatsApp antes do envio oficial.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <label className="block space-y-2 text-sm font-medium">Número de teste
            <select className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm font-normal" value={userId} disabled={busy||Boolean(status)||Boolean(requestId.current)} onChange={event=>setUserId(event.target.value)}>
              {!contacts.length&&<option value="">{busy?'Carregando…':'Nenhum número configurado'}</option>}
              {contacts.map(contact=><option key={contact.id} value={contact.id}>{phoneLabel(contact.phone)} · {contact.name??'Teste'}</option>)}
            </select>
          </label>
          <p className="text-sm text-muted-foreground">Envia uma mensagem só para este número, usando o primeiro nome cadastrado. O público, o agendamento e os resultados da campanha ficam intactos.</p>
          <p className="text-xs text-muted-foreground">O teste pode ser cobrado pela Meta e não desconta do orçamento reservado para o envio oficial.</p>
          {!busy&&!contacts.length&&<p className="text-sm text-muted-foreground">Peça a um administrador para cadastrar um destinatário de teste.</p>}
          {status&&<div role="status" className="space-y-1 rounded-md bg-muted p-3 text-sm">
            {status==='accepted'?<><p className="flex items-center gap-2 font-medium"><Check className="size-4 text-emerald-600"/>Teste aceito pela Meta</p><p className="text-muted-foreground">Confira a chegada da mensagem no seu WhatsApp.</p></>:status==='failed'?<p>Teste recusado pela Meta. Confira o número e a conta antes de repetir.</p>:<p>Não foi possível confirmar o envio. Confira seu WhatsApp antes de iniciar outro teste para evitar uma mensagem duplicada.</p>}
          </div>}
          {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>Fechar</Button>
            {status?<Button variant="outline" onClick={()=>{requestId.current=null;setStatus('');setError('');}}>Preparar outro teste</Button>:<Button disabled={busy||!userId} onClick={send}>{busy&&<Loader2 className="size-4 animate-spin"/>}{requestId.current?'Consultar tentativa / tentar novamente':'Enviar 1 mensagem de teste'}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
