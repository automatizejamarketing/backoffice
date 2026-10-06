"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, CalendarClock, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterDate } from "@/components/ui/filter";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CAMPAIGN_STATE_LABELS, RECIPIENT_STATE_LABELS, campaignMetaLookupLabel, canConfirmCampaignSend, type CampaignMetaLookup } from "@/lib/backoffice/whatsapp-campaign-core";
import { OCTOBER_WHATSAPP_TEMPLATES, OCTOBER_PENDING_MESSAGES } from "@/lib/backoffice/whatsapp-october-templates";
import { campaignBudgetMicros, formatCampaignBudgetInput, campaignBudgetReach } from "@/lib/backoffice/whatsapp-campaign-budget";
import { WhatsappMessagePreview } from "./whatsapp-message-preview";
import type { CampaignMetaTemplate } from "@/lib/backoffice/whatsapp-meta";

import { AUDIENCE_STATUSES, DEFAULT_AUDIENCE_FILTERS, audienceDateBounds, audienceDateCondition, templateRejectionReason, readRate, type AudienceFilters, type AudienceStatus } from "@/lib/backoffice/whatsapp-campaign-audience";
import type { CampaignPricing } from "@/lib/backoffice/whatsapp-campaign-pricing";

type Campaign = {
  id: string; title: string; template_name: string; body: string; state: string; audience_filters: AudienceFilters;
  scheduled_at: string | null; dispatch_mode: "manual" | "scheduled"; unit_cost_micros: number; budget_micros: string;
  total: number; sent: number; delivered: number; read: number; failed: number; pending: number; unknown: number; excluded: number;
};
type Contact = { id: string; name: string | null; email: string; phone: string; created_at: string | null; expiration_date: string | null; account_status: AudienceStatus };
type Recipient = { id: string; name: string | null; email: string; state: string; reason: string | null; current_status: string | null };
type Metrics = { total:number; sent:number; delivered:number; read:number; failed:number; tracked_clicks:number; trials:number; paying:number; windowDays:number };
type Detail = { metrics: Metrics; metaLookup: CampaignMetaLookup; campaign: Campaign; recipients: Recipient[]; template: CampaignMetaTemplate | null };
type Form = { id: string; title: string; templateName: string; body: string; budget: string };
const AUDIENCE_STATUS_ORDER = Object.keys(AUDIENCE_STATUSES) as AudienceStatus[];
const currency = (micros: number) => (micros / 1_000_000).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateLabel = (date: string) => new Date(date).toLocaleString("pt-BR", {timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"});
const templateStatus: Record<string,string> = {APPROVED:"Aprovado",PENDING:"Em análise",REJECTED:"Rejeitado",PAUSED:"Pausado",DISABLED:"Desativado"};
async function api(body?: unknown, id?: string, days=7) {
  const response = await fetch(`/api/whatsapp/campaigns${id ? `?id=${id}&days=${days}` : ''}`, body ? { method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify(body) } : {cache:'no-store'});
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
  const [audienceFilters,setAudienceFilters]=useState<AudienceFilters>(DEFAULT_AUDIENCE_FILTERS);
  const [filtersExpanded,setFiltersExpanded]=useState(true);
  const filtersPanelId=useId();
  const [filtersApplied,setFiltersApplied]=useState(true);
  const [reportDays,setReportDays]=useState(7);
  const [pendingExpanded,setPendingExpanded]=useState(false);
  const reload=useCallback(async()=>{
    setLoading(true);setError('');
    try {const data=await api();setPricing(data.pricing);setCampaigns(data.campaigns);setAudience(data.audience);setConfigured(data.configured);setEnabled(data.enabled);}
    catch(e){setError(e instanceof Error?e.message:'Falha ao carregar.');}
    finally {setLoading(false);}
  },[]);
  useEffect(()=>{void reload();},[reload]);
  async function inspect(id:string,days=reportDays){setBusy(true);try{setDetail(await api(undefined,id,days));}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}
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
  async function loadAudience(filters:AudienceFilters) {
    setBusy(true);setAudience([]);setSelected([]);setConfirmed(false);
    try {const response=await fetch(`/api/whatsapp/campaigns?audience=${encodeURIComponent(JSON.stringify(filters))}`,{cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error);setAudience(result.audience);setFiltersApplied(true);}
    catch(e){setFiltersApplied(false);toast.error((e as Error).message);}finally{setBusy(false);}
  }
  function changeFilters(filters:AudienceFilters){setAudienceFilters(filters);setFiltersApplied(false);setAudience([]);setSelected([]);setConfirmed(false);}
  async function configureAudience(){if(!detail)return;const filters=detail.campaign.audience_filters??DEFAULT_AUDIENCE_FILTERS;setAudienceFilters(filters);setScheduledAt('');setDispatchMode('manual');setQuery('');setFiltersExpanded(true);setScheduleOpen(true);await loadAudience(filters);}
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
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Prepare as mensagens, segmente seus clientes e acompanhe a aprovação e os resultados das campanhas.</p>
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
          const needsConfiguration = !campaign;
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
                  : campaign.state==='draft' ? 'Rascunho salvo. Falta definir o público e confirmar o envio.' : campaign.scheduled_at ? `${campaign.dispatch_mode === 'manual' ? 'Iniciado manualmente' : 'Agendamento'}: ${dateLabel(campaign.scheduled_at)}` : 'Consulte os detalhes da campanha.'}</p>
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
    <Dialog open={Boolean(detail)} onOpenChange={open=>{if(!open&&!busy){setDetail(null);setScheduleOpen(false);}}}><DialogContent className="w-[calc(100%_-_2rem)] grid-cols-1 max-h-[90dvh] min-w-0 overflow-y-auto [overflow-wrap:anywhere] [&>*]:min-w-0 sm:max-w-3xl"><DialogHeader><DialogTitle>{scheduleOpen?'Configurar envio':detail?.campaign.title}</DialogTitle><DialogDescription>{scheduleOpen?'Escolha e salve os filtros do público. Os destinatários escolhidos só são salvos ao confirmar o envio.':'Aprovação, público e acompanhamento desta campanha.'}</DialogDescription></DialogHeader>
      {scheduleOpen ? <>
      <div className="space-y-4">
        {!canConfirmCampaignSend(enabled,detail?.template?.status)&&<p role="status" className="rounded-md border bg-muted/40 p-3 text-sm">Você pode conferir e selecionar o público. A confirmação permanece bloqueada até a integração estar conectada, o template aprovado pela Meta e os disparos habilitados.</p>}
        <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Como deseja disparar?</legend>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"><input type="radio" name="dispatch-mode" className="mt-1 accent-primary" checked={dispatchMode==='manual'} onChange={()=>{setDispatchMode('manual');setConfirmed(false);}}/><span className="flex-1"><span className="block font-medium">Manual · enviar agora</span><span className="text-muted-foreground">Só começa quando você confirmar abaixo. O envio entra na fila e pode levar alguns minutos.</span></span></label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"><input type="radio" name="dispatch-mode" className="mt-1 accent-primary" checked={dispatchMode==='scheduled'} onChange={()=>{setDispatchMode('scheduled');setConfirmed(false);}}/><span className="flex-1"><span className="block font-medium">Automático · agendar</span><span className="text-muted-foreground">Começa na data e hora escolhidas, sem precisar voltar para confirmar.</span></span></label>
        </fieldset>
        {dispatchMode==='scheduled'&&<label className="block space-y-1 text-sm">Data e hora · Brasília<Input type="datetime-local" value={scheduledAt} onChange={e=>{setScheduledAt(e.target.value);setConfirmed(false);}}/></label>}
        <section className="min-w-0 border-t pt-2">
          <button type="button" aria-expanded={filtersExpanded} aria-controls={filtersPanelId} onClick={()=>setFiltersExpanded(value=>!value)} className="flex w-full items-center justify-between gap-3 rounded-md py-2 text-left text-sm outline-none hover:text-foreground/80 focus-visible:ring-2 focus-visible:ring-ring">
            <span className="min-w-0"><span className="block font-medium">Público da campanha</span>{!filtersExpanded&&<span className="mt-1 block text-xs text-muted-foreground">{audienceFilters.statuses.map(status=>AUDIENCE_STATUSES[status]).join(' · ')||'Nenhuma situação selecionada'}{(audienceFilters.createdFrom||audienceFilters.createdTo)?' · Cadastro filtrado':''}{(audienceFilters.expiresFrom||audienceFilters.expiresTo)?' · Expiração filtrada':''}{audienceFilters.excludeContacted?' · Exclui atendidos':''}{!filtersApplied?' · Alterações não salvas':''}</span>}</span>
            <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none ${filtersExpanded?'rotate-180':''}`}/>
          </button>
          <div id={filtersPanelId} inert={!filtersExpanded} aria-hidden={!filtersExpanded} className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${filtersExpanded?'grid-rows-[1fr] opacity-100':'grid-rows-[0fr] opacity-0'}`}>
          <div className="min-h-0 overflow-hidden">
          <fieldset disabled={busy} className="min-w-0"><legend className="sr-only">Filtros do público</legend>
          <div className="mt-4 grid min-w-0 gap-x-6 gap-y-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-y-5">
            <div id="audience-status-label" className="text-sm sm:pt-1.5"><span className="font-medium">Situação da conta</span><span className="block text-xs text-muted-foreground">Uma ou mais</span></div>
            <ToggleGroup type="multiple" variant="outline" size="sm" spacing={2} aria-labelledby="audience-status-label" className="w-full min-w-0 flex-wrap"
              value={audienceFilters.statuses} onValueChange={values=>changeFilters({...audienceFilters,statuses:AUDIENCE_STATUS_ORDER.filter(status=>values.includes(status))})}>
              {AUDIENCE_STATUS_ORDER.map(status=><ToggleGroupItem key={status} value={status} className="group/status h-8 gap-2 pl-2 pr-3 font-normal hover:text-foreground data-[state=on]:border-foreground/30 data-[state=on]:bg-accent data-[state=on]:text-foreground">
                <span aria-hidden="true" className="flex size-4 items-center justify-center rounded-[4px] border border-input transition-colors group-data-[state=on]/status:border-primary group-data-[state=on]/status:bg-primary group-data-[state=on]/status:text-primary-foreground"><Check className="size-3 opacity-0 group-data-[state=on]/status:opacity-100"/></span>
                {AUDIENCE_STATUSES[status]}
              </ToggleGroupItem>)}
            </ToggleGroup>
            <div className="mt-3 text-sm sm:mt-0 sm:pt-1.5"><span className="font-medium">Datas</span><span className="block text-xs text-muted-foreground">Horário de Brasília</span></div>
            <div className="flex min-w-0 flex-wrap gap-2">
              <FilterDate label="Cadastro" placeholder="Qualquer data" maxDate={new Date()} className="h-8 w-full sm:w-auto" value={audienceDateCondition(audienceFilters.createdFrom,audienceFilters.createdTo)} onChange={condition=>{const {from,to}=audienceDateBounds(condition);changeFilters({...audienceFilters,createdFrom:from,createdTo:to});}}/>
              <FilterDate label="Expiração" placeholder="Qualquer data" className="h-8 w-full sm:w-auto" value={audienceDateCondition(audienceFilters.expiresFrom,audienceFilters.expiresTo)} onChange={condition=>{const {from,to}=audienceDateBounds(condition);changeFilters({...audienceFilters,expiresFrom:from,expiresTo:to});}}/>
            </div>
            <div className="mt-3 text-sm font-medium sm:mt-0 sm:pt-0.5">Atendimento</div>
            <label className="flex min-w-0 cursor-pointer items-start gap-3 text-sm"><Switch className="mt-0.5" checked={audienceFilters.excludeContacted} onCheckedChange={checked=>changeFilters({...audienceFilters,excludeContacted:checked})}/><span>Excluir quem já foi atendido<span className="block text-xs text-muted-foreground">Histórico no CRM ou no WhatsApp integrado</span></span></label>
          </div>
          <div className="mt-5 flex flex-col gap-3 rounded-lg bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p role="status" className="flex min-w-0 items-center gap-2 text-sm">
              {busy ? <><Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"/><span className="text-muted-foreground">Atualizando público…</span></>
                : !audienceFilters.statuses.length ? <span className="text-destructive">Escolha ao menos uma situação da conta.</span>
                : !filtersApplied ? <><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-amber-500"/><span>Filtros alterados. Salve para ver o público.</span></>
                : <span><span className="font-semibold tabular-nums">{audience.length.toLocaleString('pt-BR')}</span> <span className="text-muted-foreground">{audience.length===1?'contato elegível':'contatos elegíveis'}</span></span>}
            </p>
            <Button size="sm" type="button" className="shrink-0" variant={filtersApplied?'outline':'default'} disabled={busy||!audienceFilters.statuses.length} onClick={async()=>{if(!detail)return;const result=await mutate('saveAudience',detail.campaign.id,audienceFilters);if(result){setDetail({...detail,campaign:{...detail.campaign,...result.campaign}});await loadAudience(audienceFilters);toast.success('Filtros salvos.');}}}>Salvar filtros e atualizar público</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Contas internas e telefones duplicados ficam de fora. Os filtros são conferidos de novo antes de cada envio.</p>
        </fieldset>
          </div>
          </div>
        </section>
        <div className="flex flex-wrap items-center gap-2"><Input className="min-w-0 basis-full sm:basis-0 sm:flex-1" aria-label="Buscar destinatários" placeholder="Buscar por nome ou email" value={query} onChange={e=>setQuery(e.target.value)}/><Button variant="outline" size="sm" disabled={busy||!filtersApplied} onClick={()=>{setSelected(visibleAudience.map(c=>c.id));setConfirmed(false);}}>Selecionar filtrados</Button><Button variant="ghost" size="sm" onClick={()=>{setSelected([]);setConfirmed(false);}}>Limpar</Button></div>
        <div className="max-h-56 overflow-y-auto rounded-md border">{visibleAudience.map(c=><label key={c.id} className="flex cursor-pointer items-start gap-3 border-b p-3 text-sm last:border-b-0 hover:bg-muted/30"><Checkbox className="mt-0.5" checked={selected.includes(c.id)} onCheckedChange={checked=>{setSelected(checked===true?[...selected,c.id]:selected.filter(id=>id!==c.id));setConfirmed(false);}}/><span className="min-w-0 [overflow-wrap:anywhere]">{c.name??c.email}<span className="block text-xs text-muted-foreground">{c.email}</span><span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><Badge variant="secondary">{AUDIENCE_STATUSES[c.account_status]}</Badge><span>Criada: {c.created_at?dateLabel(c.created_at):'Não informada'}</span><span>Expira: {c.expiration_date?dateLabel(c.expiration_date):'Sem data'}</span></span></span></label>)}{!visibleAudience.length&&<p className="p-4 text-sm text-muted-foreground">Nenhum contato elegível encontrado.</p>}</div>
        <div className="flex flex-wrap justify-between gap-2 border-y py-3 text-sm"><span>{selected.length} destinatários</span><span className={aboveBudget?'text-destructive font-medium':'font-medium'}>Estimativa: {currency(selectedCost)} · orçamento: {currency(Number(detail?.campaign.budget_micros??0))}</span></div>
        <label className="flex cursor-pointer items-start gap-3 text-sm"><Checkbox className="mt-0.5" checked={confirmed} onCheckedChange={checked=>setConfirmed(checked===true)}/><span>Conferi a mensagem, a tarifa e o público selecionado, incluindo permissões de contato e pedidos para não receber mensagens.</span></label>
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={()=>setScheduleOpen(false)}>Voltar</Button><Button disabled={busy||!filtersApplied||!canConfirmCampaignSend(enabled,detail?.template?.status)||!confirmed||!selected.length||(dispatchMode==='scheduled'&&!scheduledAt)||aboveBudget||!detail?.campaign.unit_cost_micros} onClick={async()=>{if(!detail)return;const result=await mutate(dispatchMode==='manual'?'sendNow':'schedule',detail.campaign.id,{...(dispatchMode==='scheduled'?{scheduledAt:`${scheduledAt}:00-03:00`}:{}),userIds:selected});if(result){toast.success(dispatchMode==='manual'?'Envio manual iniciado.':'Envio automático agendado.');setScheduleOpen(false);await inspect(detail.campaign.id);}}}>{dispatchMode==='manual'?'Confirmar envio agora':'Confirmar agendamento'}</Button></div>
      </div>
      </> : <>
      {detail&&<div className="space-y-4"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{detail.campaign.state==='scheduled'&&detail.campaign.dispatch_mode==='manual'?'Envio iniciado':CAMPAIGN_STATE_LABELS[detail.campaign.state]}</Badge><Badge variant="outline" className={detail.template?.status==='APPROVED'?'border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400':undefined}>{detail.template?.status==='APPROVED'&&<Check aria-hidden="true"/>}Meta: {detail.template?(templateStatus[detail.template.status]??detail.template.status):campaignMetaLookupLabel(detail.metaLookup)}</Badge></div>
        {detail.metaLookup==='disconnected'&&<p role="status" className="rounded-md border bg-muted/40 p-3 text-sm">Seu rascunho está salvo. A conexão do backoffice com a Meta precisa ser configurada para consultar e enviar templates. Isso não informa se o template já foi enviado pelo WhatsApp Manager.</p>}
        {detail.metaLookup==='unavailable'&&<p role="status" className="text-sm text-muted-foreground">Não foi possível consultar a Meta. Use Atualizar status para tentar novamente.</p>}
        <WhatsappMessagePreview body={detail.campaign.body}/>
        {templateRejectionReason(detail.template?.status,detail.template?.rejected_reason)&&<p role="alert" className="text-sm text-destructive">{templateRejectionReason(detail.template?.status,detail.template?.rejected_reason)}</p>}
        <div className="flex flex-wrap gap-2">{detail.campaign.state==='draft'?<><Button variant="outline" disabled={busy} onClick={()=>edit(detail.campaign)}>Editar</Button><Button variant="outline" disabled={busy||!configured||detail.template?.status==='APPROVED'} onClick={async()=>{const result=await mutate('submit',detail.campaign.id);if(result){toast.success(result.existing?'Template já cadastrado na Meta.':'Template enviado para análise da Meta.');await inspect(detail.campaign.id);}}}>{detail.template?.status==='APPROVED'?'Template aprovado':'Enviar template à Meta'}</Button><Button disabled={busy} onClick={configureAudience}><CalendarClock className="size-4"/>Configurar envio</Button></>:detail.campaign.state==='scheduled'||detail.campaign.state==='paused'?<Button disabled={busy} variant="outline" onClick={async()=>{if(await mutate(detail.campaign.state==='paused'?'resume':'pause',detail.campaign.id)){await inspect(detail.campaign.id);toast.success('Campanha atualizada.');}}}>{detail.campaign.state==='paused'?'Retomar envios':'Pausar envios'}</Button>:null}<Button variant="ghost" disabled={busy} onClick={()=>inspect(detail.campaign.id)}>Atualizar status</Button></div>
        <section aria-label="Resultados da campanha" className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">Resultados da campanha</h3><label className="flex items-center gap-2 text-xs text-muted-foreground">Conversões após a entrega<select aria-label="Janela de conversão" className="rounded-md border bg-background px-2 py-1 text-foreground" value={reportDays} disabled={busy} onChange={e=>{const days=Number(e.target.value);setReportDays(days);void inspect(detail.campaign.id,days);}}>{[7,14,30].map(days=><option key={days} value={days}>{days} dias</option>)}</select></label></div>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
            {[
              ['Enviadas',String(detail.metrics.sent),'Aceitas pela Meta'],
              ['Entregues',String(detail.metrics.delivered),'Entrega confirmada pelo WhatsApp'],
              ['Leitura confirmada',readRate(detail.metrics.read,detail.metrics.delivered)===null?'—':`${readRate(detail.metrics.read,detail.metrics.delivered)!.toLocaleString('pt-BR',{maximumFractionDigits:1})}%`,`${detail.metrics.read} lidas de ${detail.metrics.delivered} entregues`],
              ['Iniciaram trial',String(detail.metrics.trials),`Pessoas com trial nos ${reportDays} dias seguintes`],
              ['Pagaram',String(detail.metrics.paying),'Assinatura ou reativação paga; exclui créditos avulsos'],
              ['Falhas',String(detail.metrics.failed),'Falha confirmada no envio ou na entrega'],
              ['Cliques no link',detail.metrics.tracked_clicks?String(detail.metrics.tracked_clicks):'Não rastreado','Links diretos no texto não identificam quem clicou'],
              ['Entraram em contato','Não rastreado','Clique não comprova conversa no número de atendimento'],
              ['Gasto exato','Não disponível',`Estimativa das entregues: ${currency(detail.metrics.delivered*detail.campaign.unit_cost_micros)}`],
            ].map(([label,value,caption])=><div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd><p className="mt-1 text-xs text-muted-foreground">{caption}</p></div>)}
          </dl><p className="text-xs text-muted-foreground">Trial e pagamento contam pessoas únicas por campanha, após entrega confirmada. São eventos posteriores, não prova de que a campanha causou a conversão; uma pessoa pode aparecer em campanhas diferentes. Leitura depende da confirmação disponibilizada pelo WhatsApp. Gasto exato exige conciliação com a cobrança da Meta.</p>
        </section>
        {detail.recipients.length>0&&<div className="overflow-x-auto border-t"><p className="py-3 text-sm font-medium">Destinatários · até 1.000 registros</p><table className="w-full text-left text-sm"><tbody>{detail.recipients.map(r=><tr key={r.id} className="border-t"><td className="py-3 pr-3"><p>{r.name??r.email}</p><p className="text-xs text-muted-foreground">{r.email}</p>{r.reason&&<p className="mt-1 max-w-sm text-xs text-muted-foreground">{r.reason}</p>}</td><td className="py-3 pr-3">{r.current_status==='read'?'Lida':r.current_status==='delivered'?'Entregue':r.current_status==='failed'?'Falhou':RECIPIENT_STATE_LABELS[r.state]}</td><td>{r.state==='pending'&&<Button size="sm" variant="ghost" disabled={busy} onClick={async()=>{if(await mutate('exclude',detail.campaign.id,r.id))await inspect(detail.campaign.id);}}>Retirar</Button>}</td></tr>)}</tbody></table></div>}
      </div>}
      </>}
    </DialogContent></Dialog>
  </div>;
}
