import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RuleCacheService } from '../rules/rule-cache.service';
import type { CreateFieldDto, UpdateFieldDto } from './fields.schemas';

/** Plain-scalar B.2 metadata, assignable to both create and update data. */
interface FieldMetaWrite {
  unit?: string | null;
  precision?: number | null;
  nullable?: boolean;
  defaultIfMissing?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  source?: CreateFieldDto['source'];
  enumValues?: string[];
  lookupUrl?: string | null;
  lookupFallback?: CreateFieldDto['lookupFallback'];
  // P0.1 Request Portal metadata.
  userSubmittable?: boolean;
  contexts?: string[];
  label?: string | null;
  helpText?: string | null;
  inputType?: CreateFieldDto['inputType'];
  displayOrder?: number | null;
}

/** The B.2 metadata fields common to the create and update DTOs. */
interface FieldMetaInput {
  unit?: string | null;
  precision?: number | null;
  nullable?: boolean;
  defaultIfMissing?: unknown;
  source?: CreateFieldDto['source'];
  enumValues?: string[];
  lookupUrl?: string | null;
  lookupFallback?: CreateFieldDto['lookupFallback'];
  userSubmittable?: boolean;
  contexts?: string[];
  label?: string | null;
  helpText?: string | null;
  inputType?: CreateFieldDto['inputType'];
  displayOrder?: number | null;
}

/** Maps the optional B.2 metadata fields from a DTO to a Prisma data payload. */
function metaData(dto: FieldMetaInput): FieldMetaWrite {
  const data: FieldMetaWrite = {};
  if (dto.unit !== undefined) data.unit = dto.unit;
  if (dto.precision !== undefined) data.precision = dto.precision;
  if (dto.nullable !== undefined) data.nullable = dto.nullable;
  if (dto.defaultIfMissing !== undefined) {
    // An explicit null default is stored as JSON null, not a cleared column.
    data.defaultIfMissing =
      dto.defaultIfMissing === null
        ? Prisma.JsonNull
        : (dto.defaultIfMissing as Prisma.InputJsonValue);
  }
  if (dto.source !== undefined) data.source = dto.source;
  if (dto.enumValues !== undefined) data.enumValues = dto.enumValues;
  if (dto.lookupUrl !== undefined) data.lookupUrl = dto.lookupUrl;
  if (dto.lookupFallback !== undefined) data.lookupFallback = dto.lookupFallback;
  if (dto.userSubmittable !== undefined) data.userSubmittable = dto.userSubmittable;
  if (dto.contexts !== undefined) data.contexts = dto.contexts;
  if (dto.label !== undefined) data.label = dto.label;
  if (dto.helpText !== undefined) data.helpText = dto.helpText;
  if (dto.inputType !== undefined) data.inputType = dto.inputType;
  if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder;
  return data;
}

/**
 * B.3 #10: lookup config is only meaningful on looked_up fields, and a
 * looked_up field must know where to resolve from.
 */
function assertLookupConfig(source: string | null | undefined, lookupUrl: string | null): void {
  if (source === 'looked_up') {
    if (!lookupUrl) {
      throw new BadRequestException('looked_up fields require a lookupUrl');
    }
  } else if (lookupUrl) {
    throw new BadRequestException('lookupUrl is only allowed when source is looked_up');
  }
}

@Injectable()
export class FieldsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly ruleCache: RuleCacheService,
  ) {}

  async list(tenantId: string) {
    const items = await this.tenantPrisma
      .forTenant(tenantId)
      .fieldDefinition.findMany({ orderBy: { name: 'asc' } });
    return { items };
  }

  async create(tenantId: string, dto: CreateFieldDto) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const existing = await client.fieldDefinition.findFirst({ where: { name: dto.name } });
    if (existing) throw new ConflictException(`Field "${dto.name}" is already defined`);
    assertLookupConfig(dto.source, dto.lookupUrl ?? null);

    const field = await client.fieldDefinition.create({
      data: {
        tenantId,
        name: dto.name,
        type: dto.type,
        description: dto.description,
        ...metaData(dto),
      },
    });
    await this.ruleCache.invalidateFieldSchema(tenantId);
    return field;
  }

  async update(tenantId: string, fieldId: string, dto: UpdateFieldDto) {
    const client = this.tenantPrisma.forTenant(tenantId);
    const existing = await client.fieldDefinition.findUnique({ where: { id: fieldId } });
    if (!existing) throw new NotFoundException('Field not found');

    // Validate the *effective* post-update config, not just the patch.
    const nextSource = dto.source !== undefined ? dto.source : existing.source;
    const nextLookupUrl = dto.lookupUrl !== undefined ? dto.lookupUrl : existing.lookupUrl;
    assertLookupConfig(nextSource, nextLookupUrl);

    const field = await client.fieldDefinition.update({
      where: { id: fieldId },
      data: {
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...metaData(dto),
      },
    });
    await this.ruleCache.invalidateFieldSchema(tenantId);
    return field;
  }

  async remove(tenantId: string, fieldId: string): Promise<{ id: string }> {
    const client = this.tenantPrisma.forTenant(tenantId);
    const existing = await client.fieldDefinition.findUnique({ where: { id: fieldId } });
    if (!existing) throw new NotFoundException('Field not found');

    await client.fieldDefinition.delete({ where: { id: fieldId } });
    await this.ruleCache.invalidateFieldSchema(tenantId);
    return { id: fieldId };
  }
}
