"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CAMPAIGN_STATE_LABELS, RECIPIENT_STATE_LABELS } from "@/lib/backoffice/whatsapp-campaign-core";
import { OCTOBER_WHATSAPP_TEMPLATES, OCTOBER_PENDING_MESSAGES } from "@/lib/backoffice/whatsapp-october-templates";
import { campaignBudgetMicros, formatCampaignBudgetInput, campaignBudgetReach } from "@/lib/backoffice/whatsapp-campaign-budget";
import { WhatsappMessagePreview } from "./whatsapp-message-preview";
import type { CampaignMetaTemplate } from "@/lib/backoffice/whatsapp-meta";

import type { CampaignPricing } from "@/lib/backoffice/whatsapp-campaign-pricing";

type Campaign = {
  id: string; title: string; template_name: string; body: string; state: string;
  scheduled_at: string | null; dispatch_mode: "manual" | "scheduled"; unit_cost_micros: number; budget_micros: string;
  total: number; sent: number; delivered: number; read: number; failed: number; pending: number; unknown: number; excluded: number;
};
type Contact = { id: string; name: string | null; email: string; phone: string };
type Recipient = { id: string; name: string | null; email: string; state: string; reason: string | null; current_status: string | null };
type Detail = { campaign: Campaign; recipients: Recipient[]; template: CampaignMetaTemplate | null };
type Form = { id: string; title: string; templateName: string; body: string; budget: string };
const currency = (micros: number) => (micros / 1_000_000).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateLabel = (date: string) => new Date(date).toLocaleString("pt-BR", {timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"});
const templateStatus: Record<string,string> = {APPROVED:"Aprovado",PENDING:"Em análise",REJECTED:"Rejeitado",PAUSED:"Pausado",DISABLED:"Desativado"};
async function api(body?: unknown, id?: string) {
  const response = await fetch(`/api/whatsapp/campaigns${id ? `?id=${id}` : ''}`, body ? { method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify(body) } : {cache:'no-store'});
  const payload = await response.json();
  if(!response.ok)throw new Error(payload.error || 'Não foi possível carregar as campanhas.');
  return payload;
}

export function WhatsappCampaignsClient() {
  const [campaigns,setCampaigns]=useState<Campaign[]>([]);
  const [audience,setAudience]=useState<Contact[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [pricing,setPricing]=useState<CampaignPricing|null>(null);
  const [configured,setConfigured]=useState(false);
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(false);
  const [form,setForm]=useState<Form|null>(null);
  const [preview,setPreview]=useState<typeof OCTOBER_WHATSAPP_TEMPLATES[number]|null>(null);
  const [detail,setDetail]=useState<Detail|null>(null);
  const [scheduleOpen,setScheduleOpen]=useState(false);
  const [selected,setSelected]=useState<string[]>([]);
  const [scheduledAt,setScheduledAt]=useState('');
  const [dispatchMode,setDispatchMode]=useState<'manual'|'scheduled'>('manual');
  const [query,setQuery]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [pendingExpanded,setPendingExpanded]=useState(false);
  const reload=useCallback(async()=>{
    setLoading(true);setError('');
    try {const data=await api();setPricing(data.pricing);setCampaigns(data.campaigns);setAudience(data.audience);setConfigured(data.configured);setEnabled(data.enabled);}
    catch(e){setError(e instanceof Error?e.message:'Falha ao carregar.');}
    finally {setLoading(false);}
  },[]);
  useEffect(()=>{void reload();},[reload]);
  async function inspect(id:string){setBusy(true);try{setDetail(await api(undefined,id));}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}
  async function mutate(action:string,id:string,data?:unknown){
    setBusy(true);
    try {const result=await api({action,id,data});await reload();return result;}
    catch(e){toast.error((e as Error).message);return null;}
    finally{setBusy(false);}
  }
  function draft(seed?:typeof OCTOBER_WHATSAPP_TEMPLATES[number]) {
    setDetail(null);setForm({id:crypto.randomUUID(),title:seed?.title??'',templateName:seed?.name??'',body:seed?.body??'',budget:''});
  }
  function edit(c:Campaign){setDetail(null);setForm({id:c.id,title:c.title,templateName:c.template_name,body:c.body,budget:currency(Number(c.budget_micros))});}
  const totalSent=campaigns.reduce((sum,c)=>sum+c.sent,0);
  const estimated=campaigns.reduce((sum,c)=>sum+c.delivered*c.unit_cost_micros,0);
  const visibleAudience=audience.filter(c=>`${c.name} ${c.email}`.toLowerCase().includes(query.toLowerCase()));
  const selectedCost=selected.length*(detail?.campaign.unit_cost_micros??0);
  const estimatedReach=campaignBudgetReach(campaignBudgetMicros(form?.budget??''),pricing?.unitCostMicros);
  const aboveBudget=selectedCost>Number(detail?.campaign.budget_micros??0);
  return <div className="mx-auto w-full max-w-[1440px] space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><Link href="/whatsapp" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5"/>Histórico do WhatsApp</Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Campanhas de WhatsApp</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Prepare as mensagens, acompanhe a aprovação da Meta e programe os envios para quem ainda não começou o trial.</p>
      </div><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Atualizar campanhas" onClick={reload} disabled={loading||busy}><RefreshCw className="size-4"/></Button><Button onClick={()=>draft()}><Plus className="size-4"/>Nova campanha</Button></div>
    </header>
    {error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">{error}<Button className="ml-3" variant="outline" size="sm" onClick={reload}>Tentar novamente</Button></div> : !loading && (!configured || !enabled) ? <div className="rounded-lg border bg-muted/40 p-4 text-sm"><p className="font-medium">{!configured?'Conecte a conta do WhatsApp para enviar os templates à Meta.':'O processamento das campanhas ainda não está habilitado.'}</p><p className="mt-1 text-muted-foreground">Você pode preparar rascunhos. Nenhuma mensagem será enviada enquanto essa configuração estiver pendente.</p></div> : null}
    <section aria-label="Resumo das campanhas" className="grid gap-5 border-y py-5 sm:grid-cols-3">
      {[['Campanhas na fila',String(campaigns.filter(c=>c.state==='scheduled').length)],['Mensagens enviadas',String(totalSent)],['Estimativa das entregues',currency(estimated)]].map(([label,value])=><div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{loading?'—':value}</p></div>)}
    </section>
    <section aria-label="Campanhas">
      {loading ? <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none"/>Carregando campanhas…</div> : campaigns.length ? <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{['Campanha','Status','Envio (Brasília)','Público','Entregues','Estimativa'].map(t=><th key={t} className="p-3 font-medium">{t}</th>)}</tr></thead><tbody>{campaigns.map(c=><tr key={c.id} className="border-t hover:bg-muted/30"><td className="p-3"><button className="text-left font-medium underline-offset-4 hover:underline focus-visible:outline-2" disabled={busy} onClick={()=>inspect(c.id)}>{c.title}</button><p className="mt-1 text-xs text-muted-foreground">{c.template_name}</p></td><td className="p-3"><Badge variant="secondary">{c.state==='scheduled'&&c.dispatch_mode==='manual'?'Envio iniciado':CAMPAIGN_STATE_LABELS[c.state]}</Badge>{c.unknown>0&&<p className="mt-1 text-xs text-destructive">{c.unknown} envio(s) a verificar</p>}</td><td className="p-3 tabular-nums">{c.scheduled_at?<><span className="block">{c.dispatch_mode==='manual'?'Manual':'Automático'}</span><span className="text-xs text-muted-foreground">{dateLabel(c.scheduled_at)}</span></>:'Aguardando decisão'}</td><td className="p-3 tabular-nums">{c.total}</td><td className="p-3 tabular-nums">{c.delivered}</td><td className="p-3 tabular-nums">{currency(c.delivered*c.unit_cost_micros)}</td></tr>)}</tbody></table></div> : <div className="py-8"><h2 className="font-medium">Prepare a primeira campanha</h2><p className="mt-1 text-sm text-muted-foreground">Use uma das mensagens de outubro abaixo ou crie um novo texto.</p></div>}
      <p className="mt-3 text-xs text-muted-foreground">Estimativas em reais, calculadas pela tarifa de referência da Meta por mensagem entregue. Não representam a fatura da Meta. Envios sem confirmação aparecem separadamente.</p>
    </section>
    <section className="space-y-3"><div><h2 className="text-lg font-semibold">Outubro · primeiro lote</h2><p className="mt-1 text-sm text-muted-foreground">Textos para o atendimento. Salvar um rascunho não agenda nem dispara mensagens.</p></div>
      <div className="divide-y rounded-lg border">
        {OCTOBER_WHATSAPP_TEMPLATES.map(template => {
          const campaign = campaigns.find(item => item.template_name === template.name);
          const needsConfiguration = !campaign || campaign.state === 'draft';
          const status = needsConfiguration ? 'Precisa de configuração'
            : campaign.state === 'scheduled' && campaign.dispatch_mode === 'manual' ? 'Envio iniciado'
            : CAMPAIGN_STATE_LABELS[campaign.state];
          return (
            <div key={template.name} className="flex flex-wrap items-start gap-4 p-4">
              <span className="w-12 shrink-0 pt-1 text-sm tabular-nums text-muted-foreground">{template.date.slice(8)}/10</span>
              <div className="min-w-[180px] flex-1 space-y-2">
                <p className="text-sm font-medium">{template.title}</p>
                <Badge variant="outline" className={needsConfiguration ? 'border-amber-600/30 bg-amber-500/10 text-amber-800 dark:text-amber-300' : ''}>{status}</Badge>
                <p className="text-xs text-muted-foreground">{needsConfiguration
                  ? 'Envio não programado. Defina público, orçamento e quando enviar.'
                  : campaign.scheduled_at ? `${campaign.dispatch_mode === 'manual' ? 'Iniciado manualmente' : 'Agendamento'}: ${dateLabel(campaign.scheduled_at)}` : 'Consulte os detalhes da campanha.'}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" size="sm" onClick={()=>setPreview(template)}>Ver mensagem</Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={()=>campaign ? inspect(campaign.id) : draft(template)}>{needsConfiguration ? 'Configurar campanha' : 'Abrir campanha'}</Button>
              </div>
            </div>
          );
        })}
      </div>
      <button className="text-sm text-muted-foreground underline underline-offset-4" onClick={()=>setPendingExpanded(v=>!v)} aria-expanded={pendingExpanded}>{pendingExpanded?'Ocultar':'Ver'} 8 mensagens com conteúdo pendente</button>
      {pendingExpanded&&<ul className="divide-y border-t">{OCTOBER_PENDING_MESSAGES.map(t=><li className="grid gap-1 py-3 text-sm sm:grid-cols-[60px_1fr_260px]" key={t.date}><span className="text-muted-foreground">{t.date.slice(8)}/10</span><span>{t.title}</span><span className="text-xs text-muted-foreground">{t.reason}</span></li>)}</ul>}
    </section>
    <Dialog open={Boolean(preview)} onOpenChange={open=>{if(!open)setPreview(null);}}>
      <DialogContent className="w-[calc(100%_-_2rem)] grid-cols-1 max-h-[90dvh] min-w-0 overflow-y-auto [overflow-wrap:anywhere] [&>*]:min-w-0 sm:max-w-lg">
        <DialogHeader><DialogTitle>{preview?.title}</DialogTitle><DialogDescription>Veja como o cliente receberia esta mensagem. Esta prévia não envia nada.</DialogDescription></DialogHeader>
        {preview&&<WhatsappMessagePreview body={preview.body}/>}
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(form)} onOpenChange={open=>{if(!open&&!busy)setForm(null);}}><DialogContent className="w-[calc(100%_-_2rem)] grid-cols-1 max-h-[90dvh] min-w-0 overflow-y-auto [overflow-wrap:anywhere] [&>*]:min-w-0 sm:max-w-3xl"><DialogHeader><DialogTitle>Preparar campanha</DialogTitle><DialogDescription>Salve o texto antes de enviar para aprovação. Use {'{{1}}'} para o primeiro nome.</DialogDescription></DialogHeader>
      {form&&<form className="min-w-0 space-y-4" onSubmit={async event=>{event.preventDefault();const result=await mutate('save',form.id,{title:form.title,templateName:form.templateName,body:form.body,budgetMicros:campaignBudgetMicros(form.budget)});if(result){setForm(null);toast.success('Rascunho salvo.');await inspect(form.id);}}}>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 [&>*]:min-w-0"><label className="space-y-1 text-sm">Nome da campanha<Input required maxLength={160} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label><label className="space-y-1 text-sm">Nome do template na Meta<Input required pattern="[a-z0-9_]+" maxLength={255} value={form.templateName} onChange={e=>setForm({...form,templateName:e.target.value})}/></label></div>
        <label className="block space-y-1 text-sm">Mensagem<Textarea className="min-w-0 [field-sizing:fixed]" required rows={11} maxLength={1024} value={form.body} onChange={e=>setForm({...form,body:e.target.value})}/><span className="block text-right text-xs text-muted-foreground">{form.body.length}/1024</span></label>
        <details className="min-w-0 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Ver prévia no WhatsApp</summary><div className="pt-4"><WhatsappMessagePreview body={form.body}/></div></details>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 [&>*]:min-w-0"><div className="space-y-1 text-sm"><p>Tarifa de referência da Meta</p><p className="font-medium">{pricing ? `${(pricing.unitCostMicros / 1e6).toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:4})} por mensagem entregue` : 'Consulta indisponível'}</p><p className="text-xs text-muted-foreground">Marketing · Brasil · tabela em reais. {pricing ? 'Atualizada automaticamente.' : 'Você pode salvar o rascunho; a tarifa será consultada novamente antes do envio.'}</p><a className="text-xs underline underline-offset-4" href="https://whatsappbusiness.com/products/platform-pricing/" target="_blank" rel="noreferrer">Ver tabela oficial da Meta</a></div><label className="space-y-1 text-sm">Orçamento máximo da campanha (R$)<Input inputMode="numeric" placeholder="R$ 0,00" aria-describedby="campaign-budget-estimate" value={form.budget} onChange={e=>setForm({...form,budget:formatCampaignBudgetInput(e.target.value)})}/><span id="campaign-budget-estimate" className="block text-xs text-muted-foreground" aria-live="polite">{estimatedReach===null ? 'A estimativa de pessoas aparecerá quando a tarifa estiver disponível.' : !campaignBudgetMicros(form.budget) ? 'Informe o orçamento para estimar quantas pessoas poderão receber.' : `Aproximadamente ${estimatedReach.toLocaleString('pt-BR')} ${estimatedReach===1?'pessoa':'pessoas'}, com uma mensagem por pessoa, pela tarifa atual.`}</span></label></div>
        <p className="text-xs text-muted-foreground">O orçamento limita o público pela estimativa da tabela oficial em reais. A cobrança efetiva depende da moeda e das condições da sua conta Meta.</p>
        <div className="flex justify-end gap-2"><Button variant="outline" type="button" disabled={busy} onClick={()=>setForm(null)}>Cancelar</Button><Button disabled={busy}>{busy&&<Loader2 className="size-4 animate-spin"/>}Salvar rascunho</Button></div>
      </form>}
    </DialogContent></Dialog>
    <Dialog open={Boolean(detail)&&!scheduleOpen} onOpenChange={open=>{if(!open&&!busy)setDetail(null);}}><DialogContent className="w-[calc(100%_-_2rem)] grid-cols-1 max-h-[90dvh] min-w-0 overflow-y-auto [overflow-wrap:anywhere] [&>*]:min-w-0 sm:max-w-3xl"><DialogHeader><DialogTitle>{detail?.campaign.title}</DialogTitle><DialogDescription>Aprovação, público e acompanhamento desta campanha.</DialogDescription></DialogHeader>
      {detail&&<div className="space-y-4"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{detail.campaign.state==='scheduled'&&detail.campaign.dispatch_mode==='manual'?'Envio iniciado':CAMPAIGN_STATE_LABELS[detail.campaign.state]}</Badge><Badge variant="outline">Meta: {detail.template?(templateStatus[detail.template.status]??detail.template.status):'Não enviado'}</Badge></div>
        <WhatsappMessagePreview body={detail.campaign.body}/>
        {detail.template?.rejected_reason&&<p role="alert" className="text-sm text-destructive">{detail.template.rejected_reason}</p>}
        <div className="flex flex-wrap gap-2">{detail.campaign.state==='draft'?<><Button variant="outline" disabled={busy} onClick={()=>edit(detail.campaign)}>Editar</Button><Button variant="outline" disabled={busy||!configured} onClick={async()=>{const result=await mutate('submit',detail.campaign.id);if(result){toast.success(result.existing?'Template já cadastrado na Meta.':'Template enviado para análise da Meta.');await inspect(detail.campaign.id);}}}>Enviar template à Meta</Button><Button disabled={busy||!enabled||detail.template?.status!=='APPROVED'} onClick={()=>{setSelected([]);setScheduledAt('');setDispatchMode('manual');setConfirmed(false);setQuery('');setScheduleOpen(true);}}><CalendarClock className="size-4"/>Configurar envio</Button></>:detail.campaign.state==='scheduled'||detail.campaign.state==='paused'?<Button disabled={busy} variant="outline" onClick={async()=>{if(await mutate(detail.campaign.state==='paused'?'resume':'pause',detail.campaign.id)){await inspect(detail.campaign.id);toast.success('Campanha atualizada.');}}}>{detail.campaign.state==='paused'?'Retomar envios':'Pausar envios'}</Button>:null}<Button variant="ghost" disabled={busy} onClick={()=>inspect(detail.campaign.id)}>Atualizar status</Button></div>
        {detail.recipients.length>0&&<div className="overflow-x-auto border-t"><p className="py-3 text-sm font-medium">Destinatários · até 1.000 registros</p><table className="w-full text-left text-sm"><tbody>{detail.recipients.map(r=><tr key={r.id} className="border-t"><td className="py-3 pr-3"><p>{r.name??r.email}</p><p className="text-xs text-muted-foreground">{r.email}</p>{r.reason&&<p className="mt-1 max-w-sm text-xs text-muted-foreground">{r.reason}</p>}</td><td className="py-3 pr-3">{r.current_status==='read'?'Lida':r.current_status==='delivered'?'Entregue':r.current_status==='failed'?'Falhou':RECIPIENT_STATE_LABELS[r.state]}</td><td>{r.state==='pending'&&<Button size="sm" variant="ghost" disabled={busy} onClick={async()=>{if(await mutate('exclude',detail.campaign.id,r.id))await inspect(detail.campaign.id);}}>Retirar</Button>}</td></tr>)}</tbody></table></div>}
      </div>}
    </DialogContent></Dialog>
    <Dialog open={scheduleOpen} onOpenChange={open=>{if(!busy)setScheduleOpen(open);}}><DialogContent className="w-[calc(100%_-_2rem)] grid-cols-1 max-h-[90dvh] min-w-0 overflow-y-auto [overflow-wrap:anywhere] [&>*]:min-w-0 sm:max-w-3xl"><DialogHeader><DialogTitle>Configurar envio</DialogTitle><DialogDescription>Você decide quando enviar. Aprovar um template ou salvar um rascunho não dispara mensagens.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Como deseja disparar?</legend>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"><input type="radio" name="dispatch-mode" className="mt-1" checked={dispatchMode==='manual'} onChange={()=>{setDispatchMode('manual');setConfirmed(false);}}/><span className="flex-1"><span className="block font-medium">Manual · enviar agora</span><span className="text-muted-foreground">Só começa quando você confirmar abaixo. O envio entra na fila e pode levar alguns minutos.</span></span></label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"><input type="radio" name="dispatch-mode" className="mt-1" checked={dispatchMode==='scheduled'} onChange={()=>{setDispatchMode('scheduled');setConfirmed(false);}}/><span className="flex-1"><span className="block font-medium">Automático · agendar</span><span className="text-muted-foreground">Começa na data e hora escolhidas, sem precisar voltar para confirmar.</span></span></label>
        </fieldset>
        {dispatchMode==='scheduled'&&<label className="block space-y-1 text-sm">Data e hora · Brasília<Input type="datetime-local" value={scheduledAt} onChange={e=>{setScheduledAt(e.target.value);setConfirmed(false);}}/></label>}
        <p className="text-xs text-muted-foreground">Apenas contas sem assinatura ou trial. Excluímos números repetidos, contas internas e contatos em atendimento identificados no CRM ou no histórico do WhatsApp. Atualize o CRM para contatos atendidos fora da plataforma.</p>
        <div className="flex flex-wrap items-center gap-2"><Input className="flex-1" aria-label="Buscar destinatários" placeholder="Buscar por nome ou email" value={query} onChange={e=>setQuery(e.target.value)}/><Button variant="outline" size="sm" onClick={()=>setSelected(visibleAudience.map(c=>c.id))}>Selecionar filtrados</Button><Button variant="ghost" size="sm" onClick={()=>setSelected([])}>Limpar</Button></div>
        <div className="max-h-56 overflow-y-auto rounded-md border">{visibleAudience.map(c=><label key={c.id} className="flex cursor-pointer items-start gap-3 border-b p-3 text-sm last:border-b-0 hover:bg-muted/30"><input className="mt-1 size-4" type="checkbox" checked={selected.includes(c.id)} onChange={e=>setSelected(e.target.checked?[...selected,c.id]:selected.filter(id=>id!==c.id))}/><span className="min-w-0 [overflow-wrap:anywhere]">{c.name??c.email}<span className="block text-xs text-muted-foreground">{c.email}</span></span></label>)}{!visibleAudience.length&&<p className="p-4 text-sm text-muted-foreground">Nenhum contato elegível encontrado.</p>}</div>
        <div className="flex flex-wrap justify-between gap-2 border-y py-3 text-sm"><span>{selected.length} destinatários</span><span className={aboveBudget?'text-destructive font-medium':'font-medium'}>Estimativa: {currency(selectedCost)} · orçamento: {currency(Number(detail?.campaign.budget_micros??0))}</span></div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>Conferi a mensagem, a tarifa e o público selecionado, incluindo permissões de contato e pedidos para não receber mensagens.</span></label>
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setScheduleOpen(false)}>Voltar</Button><Button disabled={busy||!confirmed||!selected.length||(dispatchMode==='scheduled'&&!scheduledAt)||aboveBudget||!detail?.campaign.unit_cost_micros} onClick={async()=>{if(!detail)return;const result=await mutate(dispatchMode==='manual'?'sendNow':'schedule',detail.campaign.id,{...(dispatchMode==='scheduled'?{scheduledAt:`${scheduledAt}:00-03:00`}:{}),userIds:selected});if(result){toast.success(dispatchMode==='manual'?'Envio manual iniciado.':'Envio automático agendado.');setScheduleOpen(false);await inspect(detail.campaign.id);}}}>{dispatchMode==='manual'?'Confirmar envio agora':'Confirmar agendamento'}</Button></div>
      </div>
    </DialogContent></Dialog>
  </div>;
}
