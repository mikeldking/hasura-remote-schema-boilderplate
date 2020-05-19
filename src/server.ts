import {
  ApolloServer,
  gql,
  AuthenticationError,
  ForbiddenError,
} from "apollo-server";
import { createLogger } from "bunyan";
import { GraphQLObjectType, GraphQLField } from "graphql";
import { SchemaDirectiveVisitor } from "graphql-tools";

const logger = createLogger({ name: "server" });
const port = process.env.PORT || 3002;

// Server health flag
let isServerReady = false;

interface IAuthenticatedGqlContext {
  userId: number;
  role: string;
}

class AuthDirective extends SchemaDirectiveVisitor {
  public visitObject(objectType: GraphQLObjectType) {
    const fields = objectType.getFields();

    Object.keys(fields).forEach((fieldName) => {
      const field = fields[fieldName];
      const next = field.resolve;
      field.resolve = (result, args, context, info) => {
        if (
          next &&
          context &&
          !isNaN(context.userId) &&
          typeof context.role === "string"
        ) {
          return next(result, args, context, info);
        }
        throw new AuthenticationError("You are not authenticated");
      };
    });
  }
  public visitFieldDefinition(field: GraphQLField<any, any>) {
    const next = field.resolve;
    field.resolve = (result, args, context, info) => {
      if (
        next &&
        context &&
        !isNaN(context.userId) &&
        typeof context.role === "string"
      ) {
        return next(result, args, context, info);
      }
      throw new AuthenticationError("You are not authenticated");
    };
  }
}

const typeDefs = gql`
  directive @authenticated on OBJECT | FIELD_DEFINITION

  type Hello {
    text: String!
  }

  # The "Query" type is special: it lists all of the available queries that
  # clients can execute, along with the return type for each. In this
  # # case, the "books" query returns an array of zero or more Books (defined above).
  type Query {
    hello_world: [Hello!] @authenticated
  }
`;

const resolvers = {
  Query: {
    hello_world: async (
      _: any,
      variables: any,
      { userId, role }: IAuthenticatedGqlContext
    ) => {
      return {
        text: "hello",
      };
    },
  },
};

// Initialize the graphql server
const server = new ApolloServer({
  typeDefs,
  resolvers,
  schemaDirectives: {
    authenticated: AuthDirective,
  },
  introspection: true, // This is necessary for this graph to be exposed behind Hasura
  context: ({ req }) => {
    const userIdHeader = req.headers["x-hasura-user-id"];

    if (typeof userIdHeader === "string") {
      const userId = parseInt(userIdHeader, 10);
      const role = req.headers["x-hasura-role"];

      // add the userId and role to the context
      return { userId, role };
    }
  },
  onHealthCheck: () => {
    return new Promise((resolve, reject) => {
      if (isServerReady) {
        resolve();
      } else {
        reject();
      }
    });
  },
});

// Start the graphql server
server
  .listen({
    port,
  })
  .then(({ url }) => {
    logger.info(`🚀 graphql server listening on port ${port}`);
    logger.info(`Health check at ${url}.well-known/apollo/server-health`);
    isServerReady = true;
    // If you need to do anything post-startup, place it here
    // Ex. Sync the graphql metadata data could be a good example
  });
