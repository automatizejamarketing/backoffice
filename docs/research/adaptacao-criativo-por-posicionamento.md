# Adaptação automática de criativo por posicionamento — Marketing API v25

Pesquisa + sondagem ao vivo em staging. 2026-08-18.

Scripts: `scripts/probe-creative-placement.ts` e `scripts/probe-creative-placement-2.ts`
(read-only — usam `execution_options=['validate_only']`, não criam nada).

Conta sondada: `act_832403461244988` "Karinne Correa CA" (staging, token BISU),
page `103959432392978` (LEG Educação), IG `17841454169242008`.

---

## 1. O que ficou PROVADO na sondagem

### 1.1 Chaves de `creative_features_spec` que a v25 aceita

Testadas uma a uma contra o validador do Meta:

| Chave | Resultado | Observação |
|---|---|---|
| `adapt_to_placement` | **ACEITA** | o recurso que adapta a mídia ao posicionamento |
| `image_touchups` | **ACEITA** | "cropped **and expanded**" — inclui expansão |
| `image_uncrop` | **ACEITA** | expansão generativa (IA inventa pixels) |
| `pac_relaxation` | **ACEITA** | mostra a mídia escolhida em todos os posicionamentos |
| `media_type_automation` | **ACEITA** | |
| `image_templates` | **ACEITA** | |
| `text_optimizations` | **ACEITA** | |
| `video_auto_crop` | **ACEITA** | corte/expansão automática de vídeo |
| `video_uncrop` | **ACEITA** | expansão generativa de vídeo |
| `image_background_gen` | rejeita | exige catálogo selecionado |
| `standard_enhancements` | **rejeita** | descontinuado — "Defina recursos individuais" |

Isso resolve a divergência entre a referência `AdCreativeFeaturesSpec` e o guia
"Get Started": as chaves que só apareciam no guia (`image_uncrop`,
`video_auto_crop`, `video_uncrop`) **existem e são aceitas**.

> Armadilha: mandar uma chave inválida devolve `must be one of {IG_VIDEO_NATIVE_SUBTITLE,
> IMAGE_ANIMATION, PRODUCT_BROWSING, PRODUCT_METADATA_AUTOMATION, PROFILE_CARD,
> STANDARD_ENHANCEMENTS_CATALOG, TEXT_OVERLAY_TRANSLATION}` — 7 chaves em MAIÚSCULAS.
> Isso é **outro enum**, não a lista de chaves válidas. Não sirva de referência.

### 1.2 `image_crop_style` — enum não documentado

O campo é declarado na referência mas os valores nunca foram publicados. O
validador entregou:

```
must be one of {AUTO, CROP, EXPAND, NONE, ZOOM}
```

Os cinco foram aceitos. Leitura prática:

- `AUTO` — o Meta decide (corta, expande ou dá zoom conforme o posicionamento)
- `CROP` — só recorta, nunca inventa pixel. O mais previsível.
- `EXPAND` — força expansão generativa
- `ZOOM` — amplia
- `NONE` — não adapta

### 1.3 Shapes exatos (a doc não mostra nenhum exemplo)

`adapt` e cada grupo de `placement_groups` são **objetos**, não strings:

```json
{
  "degrees_of_freedom_spec": {
    "creative_features_spec": {
      "adapt_to_placement": {
        "enroll_status": "OPT_IN",
        "customizations": {
          "image_crop_style": "AUTO",
          "aspect_ratio_config": {
            "ar_4_5":  { "adapt": { "enroll_status": "OPT_IN" } },
            "ar_9_16": { "adapt": { "enroll_status": "OPT_IN" } }
          },
          "placement_groups": {
            "vertical":   { "enroll_status": "OPT_IN" },
            "square":     { "enroll_status": "OPT_IN" },
            "horizontal": { "enroll_status": "OPT_OUT" }
          }
        }
      }
    }
  }
}
```

Passar `"adapt": "OPT_IN"` (string) é rejeitado:
`['aspect_ratio_config']['ar_4_5']['adapt'] must be a JSON object`.
O mesmo vale para `placement_groups.vertical`.

### 1.4 Funciona também em criativo de post do Instagram

Testado com `source_instagram_media_id` (o fluxo `createAdCreativeFromInstagramPost`):
baseline, `adapt_to_placement` sozinho e o combo completo — **todos aceitos**.
Isso importa porque Placement Asset Customization (caminho alternativo)
**não** é suportado com posts existentes via API.

### 1.5 O Meta ecoa as features de volta

`GET /act_X/adcreatives?fields=degrees_of_freedom_spec` devolve o que está ligado.
Dos 25 criativos lidos na conta, 23 têm `degrees_of_freedom_spec`. Chaves realmente
gravadas pelo Gerenciador nessa conta: `standard_enhancements` (23x, legado),
`advantage_plus_creative` (9x), `inline_comment` (9x), `text_optimizations` (9x),
`video_auto_crop` (9x). Ou seja: **a UI consegue ler e exibir o estado**.

### 1.6 Preview renderiza por posicionamento — mas NAO mostra a adaptacao

`GET /act_X/generatepreviews` e `GET /{ad_id}/previews` retornam iframe OK para
`MOBILE_FEED_STANDARD`, `INSTAGRAM_STANDARD`, `INSTAGRAM_STORY`, `INSTAGRAM_REELS`,
`FACEBOOK_STORY_MOBILE`, `FACEBOOK_REELS_MOBILE`.

**Porem: o preview ignora `adapt_to_placement`.** Testado com anuncio REAL pausado
(campanha `120254583564290191`), dois anuncios identicos exceto pela feature, mesma imagem
quadrada 1440x1440. Nos dois casos o Story renderiza a imagem quadrada a 318x318
dentro do frame vertical — pixel por pixel igual. As URLs dos iframes diferem
(o blob `d=` codifica a requisicao), a saida nao.

Conclusao: **nao existe forma de mostrar ao usuario o resultado da adaptacao pela
API.** So a veiculacao real produz o criativo adaptado.

### 1.7 Nenhum `asset_customization_rules` em uso

Dos 25 criativos da conta, **0** usam Placement Asset Customization.

### 1.8 A lista autoritativa: 82 chaves

Ao criar um criativo com `degrees_of_freedom_spec`, o Meta **materializa todas as
chaves** no echo do GET. Essa e a lista real da v25 — melhor fonte que qualquer
pagina de documentacao, e contem chaves que nao aparecem em nenhuma:
`image_auto_crop`, `pac_recomposition`, `pac_genai_recomposition`,
`video_uncrop_9x16_to_9x18`, `image_enhancement`, `advantage_plus_creative`.

| | | |
|---|---|---|
| `adapt_to_placement` | `add_text_overlay` | `ads_with_benefits` |
| `advantage_plus_creative` | `app_highlights` | `audio` |
| `auto_promotion_tag` | `biz_ai` | `carousel_to_video` |
| `catalog_feed_tag` | `creative_stickers` | `customize_product_recommendation` |
| `cv_transformation` | `description_automation` | `dha_optimization` |
| `dynamic_cta_text` | `dynamic_partner_content` | `enable_ncs_testimonials` |
| `enhance_cta` | `fb_feed_tag` | `fb_reels_tag` |
| `fb_story_tag` | `feed_caption_optimization` | `generate_cta` |
| `hide_price` | `hyperlink_formatting` | `ig_feed_tag` |
| `ig_glados_feed` | `ig_reels_tag` | `ig_stream_tag` |
| `ig_video_native_subtitle` | `image_animation` | `image_auto_crop` |
| `image_background_gen` | `image_banner` | `image_brightness_and_contrast` |
| `image_end_card` | `image_enhancement` | `image_templates` |
| `image_text_translation` | `image_touchups` | `image_uncrop` |
| `inline_comment` | `local_store_extension` | `media_liquidity_animated_image` |
| `media_order` | `media_type_automation` | `multi_creative_post_carousel` |
| `multi_photo_to_video` | `music_generation` | `pac_genai_recomposition` |
| `pac_recomposition` | `pac_relaxation` | `product_browsing` |
| `product_extensions` | `product_metadata_automation` | `product_tags` |
| `profile_card` | `profile_extension` | `replace_media_text` |
| `reveal_details_over_time` | `show_destination_blurbs` | `show_summary` |
| `site_extensions` | `standard_enhancements_catalog` | `text_extraction_for_headline` |
| `text_extraction_for_tap_target` | `text_formatting_optimization` | `text_generation` |
| `text_optimizations` | `text_overlay_translation` | `text_translation` |
| `translate_voiceover` | `video_auto_crop` | `video_filtering` |
| `video_highlight` | `video_highlights` | `video_to_image` |
| `video_uncrop` | `video_uncrop_9x16_to_9x18` | `wa_mm_image_filtering` |
| `wa_mm_text_truncation_length` |

### 1.9 O padrao e TUDO DESLIGADO

Criativo criado **sem** `degrees_of_freedom_spec` — exatamente o que os dois repos
mandam hoje — volta com as 82 chaves materializadas e **zero em `OPT_IN`**.

Ou seja: todo anuncio publicado pelo produto hoje sai com adaptacao de
posicionamento completamente desligada, enquanto um anuncio criado no Gerenciador
sai com ela ligada. Isso nao e uma melhoria incremental — e uma diferenca de
paridade com o Gerenciador.

---

## 2. O que NÃO ficou provado

- **O resultado visual da adaptação.** A validação prova que o Meta *aceita* o
  payload, não o que ele *renderiza*. Confirmar exige um anúncio real (ou olho
  humano nos previews) comparando `adapt_to_placement` OPT_IN vs OPT_OUT.
- **Ganho de performance.** Nada aqui mede CTR/CPA.

---

## 3. Limite estrutural da API

**Não existe endpoint que devolva o asset adaptado.** Nenhuma URL do 9:16 gerado,
nenhum arquivo. A adaptação acontece dentro do Meta na renderização. O único
retorno visível é o iframe de `generatepreviews`.

Consequência: se o produto quiser *guardar* ou *deixar o usuário ajustar* o
recorte, o processamento é nosso (sharp/ffmpeg) — e aí o caminho passa a ser
Placement Asset Customization, com todo o custo de infra que isso traz.

---

## 4. Caminhos possíveis

| | A — Advantage+ `adapt_to_placement` | B — Placement Asset Customization |
|---|---|---|
| Ação do usuário | **nenhuma** | subir/revisar 3 versões |
| Trabalho nosso | 1 campo no POST | pipeline de imagem + transcode de vídeo + storage |
| Controle do recorte | do Meta (dial `image_crop_style`) | total, nosso |
| Post do Instagram | funciona | **não suportado via API** |
| Infra nova | zero | sharp + ffmpeg + R2 + fila |
| Risco | recorte pode não agradar | timeout/custo no Vercel; atrito de UX |

---

## 5. Recomendação

**Caminho A, ligado por padrão, sem nenhuma pergunta ao usuário.**

Separando por risco de marca:

**Ligar sempre (não generativo — só reenquadra):**

```json
{
  "adapt_to_placement": { "enroll_status": "OPT_IN",
                          "customizations": { "image_crop_style": "AUTO" } },
  "pac_relaxation":     { "enroll_status": "OPT_IN" },
  "video_auto_crop":    { "enroll_status": "OPT_IN" }
}
```

**Atrás de um único toggle (generativo — a IA inventa pixels fora do quadro):**
`image_uncrop`, `video_uncrop` e `image_touchups`.

O motivo do corte: numa ferramenta que roda campanha de cliente, expandir o
criativo com conteúdo inventado é risco de marca. Reenquadrar não é.

**Onde plugar.** O marcador é limpo: **todo lugar que já seta
`contextual_multi_ads` deve passar a setar `degrees_of_freedom_spec`.**

- Caminho moderno (ponto único): `buildAdCreativeFields` em
  `lib/meta-business/marketing/creation/create-ad.ts` — já tem merge de
  `creativeExtraFields` e já usa `withValidateOnly`.
- Caminho legado no frontend: `create-leads-campaign.ts`, `create-sales-campaign.ts`,
  `create-traffic-campaign.ts` e `creative-builders.ts`.
- Backoffice: `creative-builders.ts` e `creation/create-ad.ts`.

Melhor forma: um módulo compartilhado espelhado nos dois repos (como já é feito
com `token-vault.ts`) exportando `buildCreativeFeaturesSpec(opts)`.

**Sobre mostrar preview no wizard:** os 6 iframes de `generatepreviews` mostram
o criativo dentro do frame de cada posicionamento, o que ja tem valor. Mas eles
**nao** mostram a adaptacao (ver 1.6) — nao use isso como prova do recurso para o
usuario, so como visualizacao de enquadramento.

**Efeito colateral positivo:** `standard_enhancements` agora é rejeitado na
criação. Qualquer criativo novo precisa das chaves individuais — então essa
mudança também conserta o caminho de duplicação.
