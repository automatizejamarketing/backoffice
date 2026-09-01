export type FoodCategoryResult = {
  category: "FOOD";
  subcategory: string;
  categoryConfidence: number;
};

export class FoodCategoryClassifier {
  private static readonly RULES = [
    {
      subcategory: "HAMBURGUERIA",
      keywords: [
        "hamburguer",
        "hambúrguer",
        "burger",
        "smash",
        "smash burger",
        "hamburgueria",
      ],
    },
    {
      subcategory: "PIZZARIA",
      keywords: ["pizza", "pizzaria", "pizza artesanal", "pizzaria artesanal"],
    },
    { subcategory: "PASTELARIA", keywords: ["pastel", "pastelaria"] },
    {
      subcategory: "HOT_DOG",
      keywords: ["hot dog", "hotdog", "cachorro-quente", "cachorro quente"],
    },
    { subcategory: "ACAI", keywords: ["açaí", "acai", "açaiteria"] },
    {
      subcategory: "SUSHI",
      keywords: [
        "sushi",
        "temaki",
        "sashimi",
        "restaurante japonês",
        "comida japonesa",
        "japa",
      ],
    },
    {
      subcategory: "DOCERIA",
      keywords: ["doce", "doceria", "confeitaria", "bolo", "brigadeiro", "sobremesa"],
    },
    { subcategory: "CAFETERIA", keywords: ["café", "cafe", "cafeteria", "cappuccino", "espresso"] },
    { subcategory: "PADARIA", keywords: ["pão", "padaria", "panificadora", "pão quentinho"] },
    {
      subcategory: "CHURRASCARIA",
      keywords: [
        "churrasco",
        "churrascaria",
        "espetinho",
        "picanha",
        "churras",
        "carne assada",
      ],
    },
    { subcategory: "MARMITARIA", keywords: ["marmita", "marmitaria", "quentinha", "prato feito", "pf"] },
    { subcategory: "SORVETERIA", keywords: ["sorvete", "sorveteria", "gelato"] },
    {
      subcategory: "RESTAURANTE",
      keywords: ["restaurante", "almoço", "jantar", "gastronomia", "culinária"],
    },
    { subcategory: "LANCHONETE", keywords: ["lanche", "lanchonete", "salgado", "salgados"] },
  ];

  static classify(textData: string[]): FoodCategoryResult {
    const combinedText = textData.filter(Boolean).join(" ").toLowerCase();

    for (const rule of this.RULES) {
      for (const keyword of rule.keywords) {
        if (combinedText.includes(keyword.toLowerCase())) {
          return {
            category: "FOOD",
            subcategory: rule.subcategory,
            categoryConfidence: 0.9,
          };
        }
      }
    }

    return {
      category: "FOOD",
      subcategory: "OUTROS_FOOD",
      categoryConfidence: 0.4,
    };
  }
}
