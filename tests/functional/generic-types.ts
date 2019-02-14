import "reflect-metadata";
import {
  IntrospectionObjectType,
  IntrospectionInterfaceType,
  IntrospectionNonNullTypeRef,
  IntrospectionScalarType,
  TypeKind,
  IntrospectionListTypeRef,
  graphql,
} from "graphql";

import { ObjectType, Field, Resolver, Query, InterfaceType, ClassType, Int } from "../../src";
import { getSchemaInfo } from "../helpers/getSchemaInfo";
import { getMetadataStorage } from "../../src/metadata/getMetadataStorage";

describe("Generic types", () => {
  beforeEach(() => {
    getMetadataStorage().clear();
  });

  it("shouldn't emit abstract object type", async () => {
    @ObjectType({ isAbstract: true })
    abstract class BaseType {
      @Field()
      baseField: string;
    }

    @ObjectType()
    class SampleType extends BaseType {
      @Field()
      sampleField: string;
    }

    @Resolver()
    class SampleResolver {
      @Query()
      sampleQuery(): SampleType {
        return {
          sampleField: "sampleField",
          baseField: "baseField",
        };
      }
    }

    const { schemaIntrospection } = await getSchemaInfo({ resolvers: [SampleResolver] });

    const sampleTypeInfo = schemaIntrospection.types.find(
      it => it.name === "SampleType",
    ) as IntrospectionObjectType;
    const baseTypeInfo = schemaIntrospection.types.find(it => it.name === "BaseType") as undefined;

    expect(sampleTypeInfo.fields).toHaveLength(2);
    expect(baseTypeInfo).toBeUndefined();
  });

  it("shouldn't emit abstract interface type", async () => {
    @InterfaceType({ isAbstract: true })
    abstract class BaseInterfaceType {
      @Field()
      baseField: string;
    }

    @InterfaceType()
    abstract class SampleInterfaceType extends BaseInterfaceType {
      @Field()
      sampleField: string;
    }

    @ObjectType({ implements: SampleInterfaceType })
    class SampleType implements SampleInterfaceType {
      baseField: string;
      sampleField: string;
    }

    @Resolver()
    class SampleResolver {
      @Query()
      sampleQuery(): SampleInterfaceType {
        const sample = new SampleType();
        sample.baseField = "baseField";
        sample.sampleField = "sampleField";
        return sample;
      }
    }

    const { schemaIntrospection } = await getSchemaInfo({ resolvers: [SampleResolver] });

    const sampleInterfaceTypeInfo = schemaIntrospection.types.find(
      it => it.name === "SampleInterfaceType",
    ) as IntrospectionInterfaceType;
    const baseInterfaceTypeInfo = schemaIntrospection.types.find(
      it => it.name === "BaseInterfaceType",
    ) as undefined;

    expect(sampleInterfaceTypeInfo.fields).toHaveLength(2);
    expect(baseInterfaceTypeInfo).toBeUndefined();
  });

  it("should allow to dynamically create multiple version of base generic class", async () => {
    function Connection<TItem>(TItemClass: ClassType<TItem>) {
      @ObjectType(`${TItemClass.name}Connection`, { isAbstract: true })
      class ConnectionClass {
        @Field(type => Int)
        count: number;

        @Field(type => [TItemClass])
        items: TItem[];
      }
      return ConnectionClass;
    }

    @ObjectType()
    class User {
      @Field()
      name: string;
    }

    @ObjectType()
    class Dog {
      @Field()
      canBark: boolean;
    }

    const UserConnection = Connection(User);
    type UserConnection = InstanceType<typeof UserConnection>;
    @ObjectType()
    class DogConnection extends Connection(Dog) {}

    // FIXME: refactor after inheritance instance fix
    const dogsResponseMock = new DogConnection();
    Object.assign(dogsResponseMock, {
      count: 2,
      items: [{ canBark: false }, { canBark: true }],
    });

    @Resolver()
    class GenericConnectionResolver {
      @Query(returns => UserConnection)
      users(): UserConnection {
        return {
          count: 2,
          items: [{ name: "Tony" }, { name: "Michael" }],
        };
      }

      @Query(returns => DogConnection)
      dogs(): DogConnection {
        return dogsResponseMock;
      }
    }

    const { schema, schemaIntrospection } = await getSchemaInfo({
      resolvers: [GenericConnectionResolver],
    });
    const schemaObjectTypes = schemaIntrospection.types.filter(
      it => it.kind === TypeKind.OBJECT && !it.name.startsWith("__"),
    );
    const userConnectionTypeInfo = schemaObjectTypes.find(
      it => it.name === "UserConnection",
    ) as IntrospectionObjectType;
    const userConnectionCountField = userConnectionTypeInfo.fields.find(it => it.name === "count")!;
    const userConnectionCountFieldType = (userConnectionCountField.type as IntrospectionNonNullTypeRef)
      .ofType as IntrospectionScalarType;
    const userConnectionItemsField = userConnectionTypeInfo.fields.find(it => it.name === "items")!;
    const userConnectionItemsFieldType = (((userConnectionItemsField.type as IntrospectionNonNullTypeRef)
      .ofType as IntrospectionListTypeRef).ofType as IntrospectionNonNullTypeRef)
      .ofType as IntrospectionObjectType;
    const query = /* graphql */ `
      query {
        dogs {
          count
          items {
            canBark
          }
        }
      }
    `;
    const result = await graphql(schema, query);

    // TODO: refactor to describe block with a few it block for assertion and query

    expect(schemaObjectTypes).toHaveLength(5); // Query, User, Dog, UserCon, DogCon
    expect(userConnectionTypeInfo.fields).toHaveLength(2);
    expect(userConnectionCountFieldType.kind).toBe(TypeKind.SCALAR);
    expect(userConnectionCountFieldType.name).toBe("Int");
    expect(userConnectionItemsFieldType.kind).toBe(TypeKind.OBJECT);
    expect(userConnectionItemsFieldType.name).toBe("User");
    expect(result.data!.dogs).toEqual(dogsResponseMock);
  });
});
