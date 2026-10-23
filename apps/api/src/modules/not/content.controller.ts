import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../acc/public.decorator';
import { ContentService } from './content.service';
import { intakePolicy as buildIntakePolicy } from '../inv/intake-policy';
import { accountTerms as buildAccountTerms } from './account-terms';

@ApiTags('NOT')
@Controller('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Public()
  @Get('shows')
  shows() {
    return this.content.shows();
  }

  @Public()
  @Get('contact')
  contact() {
    return this.content.contact();
  }

  @Public()
  @Get('intake-policy')
  intakePolicy() {
    return buildIntakePolicy();
  }

  @Public()
  @Get('locations')
  locations() {
    return this.content.locations();
  }

  @Public()
  @Get('account-terms')
  accountTerms() {
    return buildAccountTerms();
  }
}
