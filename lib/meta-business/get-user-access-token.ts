import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";
import {
  mapStoredMetaConnection,
  type SafeMetaConnection,
} from "./connection-record";

/**
 * Error types for access token retrieval
 */
export type GetAccessTokenError = {
  error: string;
  message: string;
  solution?: string;
  statusCode: number;
  needsReconnect?: boolean;
};

/**
 * Result type for access token retrieval
 */
export type GetAccessTokenResult =
  | {
      success: true;
      accessToken: string;
      userId: string;
      connection: SafeMetaConnection;
    }
  | { success: false; error: GetAccessTokenError };

/**
 * Get a user's Meta Business access token from the database.
 * Decrypts encrypted envelopes before returning.
 *
 * @param userId - The user ID to get the token for
 * @returns The access token if successful, or an error object if not
 */
export async function getUserAccessTokenByUserId(
  userId: string
): Promise<GetAccessTokenResult> {
  try {
    const metaAccount = await getUserMetaBusinessAccount(userId);

    if (!metaAccount) {
      return {
        success: false,
        error: {
          error: "No connected account",
          message: "User does not have a connected Meta Business Account",
          solution: "User needs to connect their Facebook account first",
          statusCode: 404,
        },
      };
    }

    let connection: SafeMetaConnection;
    try {
      connection = mapStoredMetaConnection(metaAccount);
    } catch (error) {
      console.error("Error decrypting Meta access token:", error);
      return {
        success: false,
        error: {
          error: "Token decryption failed",
          message:
            "Não foi possível descriptografar o token Meta armazenado. Verifique META_TOKEN_ENCRYPTION_KEYS no backoffice.",
          solution:
            "Configure META_TOKEN_ENCRYPTION_KEYS com o mesmo keyring do frontend.",
          statusCode: 500,
        },
      };
    }

    if (connection.connectionStatus === "needs_reconnect") {
      return {
        success: false,
        error: {
          error: "reconnect_required",
          message:
            "A conexão com o Facebook expirou ou foi invalidada e precisa ser refeita.",
          solution:
            "Peça ao usuário para reconectar a conta Meta no aplicativo.",
          statusCode: 409,
          needsReconnect: true,
        },
      };
    }

    // BISU tokens typically have null expiry; only enforce for user tokens.
    if (
      connection.tokenKind === "user" &&
      connection.tokenExpiresAt
    ) {
      const expiresAt = new Date(connection.tokenExpiresAt);
      if (expiresAt.getTime() <= Date.now()) {
        return {
          success: false,
          error: {
            error: "Token expired",
            message:
              "O token de acesso do Meta expirou. É necessário reconectar a conta.",
            solution:
              "Peça ao usuário para reconectar a conta Meta no aplicativo.",
            statusCode: 401,
            needsReconnect: true,
          },
        };
      }
    }

    return {
      success: true,
      accessToken: connection.accessToken,
      userId,
      connection,
    };
  } catch (error) {
    console.error("Error getting user access token:", error);

    return {
      success: false,
      error: {
        error: "Internal server error",
        message: "Erro ao obter o token de acesso. Tente novamente.",
        solution: "Tente novamente mais tarde.",
        statusCode: 500,
      },
    };
  }
}
