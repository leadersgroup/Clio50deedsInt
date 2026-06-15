import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapMatterToOrder, normalizeState, formatAddress } from '../src/services/fieldMapper.js';

test('normalizeState maps full names and passes through abbreviations', () => {
  assert.equal(normalizeState('California'), 'CA');
  assert.equal(normalizeState('new york'), 'NY');
  assert.equal(normalizeState('TX'), 'TX');
  assert.equal(normalizeState('tx'), 'TX');
  assert.equal(normalizeState(''), '');
});

test('formatAddress composes a single-line address', () => {
  assert.equal(
    formatAddress({ street: '123 Main St', city: 'Austin', province: 'Texas', postal_code: '78701' }),
    '123 Main St, Austin, TX 78701',
  );
});

test('mapMatterToOrder pre-fills grantor from client and marks gaps', () => {
  const matter = {
    id: 1234567,
    display_number: '00123-Estate',
    description: 'Trust funding for 456 Oak Avenue, Dallas',
    client: {
      id: 9,
      name: 'Jane Q. Smith',
      type: 'Person',
      primary_address: { street: '789 Elm St', city: 'Dallas', province: 'TX', postal_code: '75201' },
    },
    relationships: [],
    custom_field_values: [],
  };
  const order = mapMatterToOrder(matter, [
    { id: 22, name: 'Smith Family Trust', relationship: 'Trustee' },
  ]);

  assert.equal(order.matterReference.value, '00123-Estate');
  assert.equal(order.matterReference.source, 'clio');
  assert.equal(order.grantorName.value, 'Jane Q. Smith');
  assert.equal(order.grantorName.source, 'clio');
  assert.match(order.grantorAddress.value, /789 Elm St, Dallas, TX 75201/);

  // Property parsed from description (needs confirmation -> triggers county lookup).
  assert.match(order.propertyAddress.value, /456 Oak Avenue/);

  // County-lookup fields start empty with the right provenance.
  assert.equal(order.apn.value, '');
  assert.equal(order.apn.source, 'county-lookup');
  assert.equal(order.legalDescription.source, 'county-lookup');

  // Grantee candidates include the related trust contact.
  assert.equal(order.granteeCandidates.length, 1);
  assert.equal(order.granteeCandidates[0].name, 'Smith Family Trust');
});

test('mapMatterToOrder reads a configured property custom field over description', () => {
  const matter = {
    id: 1,
    display_number: 'X',
    description: 'irrelevant',
    client: { name: 'A B' },
    relationships: [],
    custom_field_values: [{ field_name: 'Property Address', value: '500 Pine St, Reno, NV 89501' }],
  };
  const order = mapMatterToOrder(matter, []);
  assert.equal(order.propertyAddress.value, '500 Pine St, Reno, NV 89501');
  assert.equal(order.propertyAddress.source, 'clio-custom-field');
  assert.equal(order.state.value, 'NV');
});
