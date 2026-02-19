import { getUserMetaBusinessAccount } from "@/lib/db/admin-queries";

/**
 * Error types for access token retrieval
 */
export type GetAccessTokenError = {
  error: string;
  message: string;
  solution?: string;
  statusCode: number;
};

/**
 * Result type for access token retrieval
 */
export type GetAccessTokenResult =
  | { success: true; accessToken: string; userId: string }
  | { success: false; error: GetAccessTokenError };

/**
 * Get a user's Meta Business access token from the database.
 *
 * @param userId - The user ID to get the token for
 * @returns The access token if successful, or an error object if not
 */
export async function getUserAccessTokenByUserId(
  userId: string
): Promise<GetAccessTokenResult> {
  try {
    // Fetch the user's Meta Business Account from the database
    const metaAccount = await getUserMetaBusinessAccount(userId);

    if (!metaAccount) {
      return {
        success: false,
        error: {
          error: "No connected account",
          message: "User does not have a connected Meta Business Account",
          solution:
            "User needs to connect their Facebook account first",
          statusCode: 404,
        },
      };
    }

    return {
      success: true,
      accessToken: metaAccount.accessToken,
      userId,
    };
  } catch (error) {
    console.error("Error getting user access token:", error);

    return {
      success: false,
      error: {
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred while retrieving access token",
        solution: "Please try again later",
        statusCode: 500,
      },
    };
  }
}
