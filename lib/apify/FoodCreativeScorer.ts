export type CreativeType =
  | "PRODUCT_SHOWCASE"
  | "OFFER"
  | "COMBO"
  | "PROMOTION"
  | "DELIVERY"
  | "TESTIMONIAL"
  | "BEHIND_THE_SCENES"
  | "BRAND"
  | "PRODUCT_PLUS_OFFER"
  | "OTHER";

export class FoodCreativeScorer {
  static calculateProductRelevance(
    textData: string[],
    category: string,
    subcategory: string,
  ): number {
    const combinedText = textData.filter(Boolean).join(" ").toLowerCase();
    let score = 0;

    const productKeywords = [
      "hamburguer",
      "hambúrguer",
      "burger",
      "smash",
      "cheeseburger",
      "x-burger",
      "x bacon",
      "pizza",
      "calabresa",
      "margherita",
      "marguerita",
      "quatro queijos",
      "pepperoni",
      "pastel",
      "pastel de carne",
      "pastel de queijo",
      "pastel de frango",
      "hot dog",
      "hotdog",
      "cachorro-quente",
      "açaí",
      "acai",
      "sushi",
      "temaki",
      "sashimi",
      "uramaki",
      "prato",
      "bebida",
      "sobremesa",
      "porção",
      "lanche",
    ];

    const foundKeywords = productKeywords.filter((k) => combinedText.includes(k));

    if (foundKeywords.length > 0) {
      score += 40;
      score += Math.min(30, foundKeywords.length * 10);
    }

    if (
      combinedText.match(
        /(veja|olha|mostra|conheça|apresentamos|novo).*?(hamburguer|pizza|pastel|sushi|açaí|lanche|prato)/i,
      )
    ) {
      score += 30;
    }

    if (score === 0 && category === "FOOD") {
      score = 20;
    }

    return Math.min(100, score);
  }

  static classifyCreativeType(textData: string[]): CreativeType {
    const combinedText = textData.filter(Boolean).join(" ").toLowerCase();

    const isOffer = combinedText.match(
      /(r\$|\$|desconto|off|%|promoção|promocao|oferta|grátis|gratis)/i,
    );
    const isCombo = combinedText.match(
      /(combo|combo|acompanha|\+ refrigerante|\+ batata)/i,
    );
    const isDelivery = combinedText.match(/(delivery|ifood|entrega|pedir|peça|app)/i);
    const isProduct = combinedText.match(
      /(hamburguer|pizza|sushi|açaí|pastel|hot dog|prato|sabor|delicioso|novo)/i,
    );

    if (isProduct && isOffer) return "PRODUCT_PLUS_OFFER";
    if (isCombo) return "COMBO";
    if (isOffer) return "OFFER";
    if (isDelivery) return "DELIVERY";
    if (isProduct) return "PRODUCT_SHOWCASE";
    if (combinedText.match(/(cliente|depoimento|falou|disse|provou)/i))
      return "TESTIMONIAL";
    if (combinedText.match(/(bastidores|preparando|cozinha|fazendo|nossa equipe)/i))
      return "BEHIND_THE_SCENES";
    if (combinedText.match(/(qualidade|nossa história|tradição)/i)) return "BRAND";

    return "OTHER";
  }

  static calculateAdvertiserContinuity(
    activeCreativesCount: number,
    daysObserved: number,
    newCreatives30Days: number,
  ): number {
    let score = 0;

    score += Math.min(40, activeCreativesCount * 4);
    score += Math.min(30, (daysObserved / 30) * 10);
    score += Math.min(30, newCreatives30Days * 6);

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  static calculateCreativeStrength(
    isActive: boolean,
    longevityDays: number,
    advertiserActiveCreativesCount: number,
    isRecent: boolean,
    productRelevanceScore: number,
  ): number {
    const activeScore = isActive ? 100 : 0;
    const longevityScore = Math.min(100, longevityDays * 2);
    const creativeVolumeScore = Math.min(100, advertiserActiveCreativesCount * 5);
    const recencyScore = isRecent ? 100 : longevityDays < 15 ? 80 : 30;

    const score =
      activeScore * 0.25 +
      longevityScore * 0.25 +
      creativeVolumeScore * 0.2 +
      recencyScore * 0.15 +
      productRelevanceScore * 0.15;

    return Math.min(100, Math.max(0, Math.round(score)));
  }
}
