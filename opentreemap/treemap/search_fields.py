# -*- coding: utf-8 -*-
from __future__ import print_function
from __future__ import unicode_literals
from __future__ import division

from django.utils.encoding import force_text
from django.utils.translation import ugettext_lazy as _
from django.utils.translation import ugettext_noop

import copy
import re

from treemap.DotDict import DotDict
from treemap.lib.object_caches import udf_defs

DEFAULT_MOBILE_SEARCH_FIELDS = DotDict({
    'standard': [
        {'identifier': 'species.id'},
        {'identifier': 'tree.diameter'},
        {'identifier': 'tree.height'}
    ],
    'missing': [
        {'identifier': 'species.id'},
        {'identifier': 'tree.diameter'},
        {'identifier': 'mapFeaturePhoto.id'}
    ]
})

DEFAULT_SEARCH_FIELDS = DotDict({
    'general': [
        {'identifier': 'mapFeature.updated_at'},
        {'identifier': 'mapFeature.updated_by'},
        {'identifier': 'tree.import_tag'},
    ],
    'missing': [
        {'identifier': 'species.id'},
        {'identifier': 'tree.diameter'},
        {'identifier': 'plot.owner_orig_id'},
        {'identifier': 'mapFeaturePhoto.id'}
    ],
    'Plot': [
        {'identifier': 'plot.owner_orig_id'}
    ],
    'Tree': [
        {'identifier': 'tree.diameter'},
        {'identifier': 'tree.date_planted'}
    ],
    'Tag': [
        {'identifier': 'tree.import_tag'},
    ]
})

DEFAULT_MOBILE_API_FIELDS = (
    {'header': ugettext_noop('Tree Information'),
     'model': 'tree',
     'field_keys': ['tree.species', 'tree.diameter',
                    'tree.height', 'tree.date_planted']},
    {'header': ugettext_noop('Planting Site Information'),
     'model': 'plot',
     'field_keys': ['plot.width', 'plot.length']},
    {'header': ugettext_noop('Stewardship'),
     'collection_udf_keys': ['plot.udf:Stewardship', 'tree.udf:Stewardship'],
     'sort_key': 'Date'}
)

DEFAULT_WEB_DETAIL_FIELDS = (
    {'header': ugettext_noop('Tree Information'),
     'model': 'tree',
     'field_keys': ['tree.id', 'tree.species', 'tree.diameter', 'tree.height',
                    'tree.canopy_height', 'tree.date_planted',
                    'tree.date_removed'],
     'collection_udf_keys': ['tree.udf:Stewardship']},
    {'header': ugettext_noop('Planting Site Information'),
     'model': 'plot',
     'field_keys': ['plot.width', 'plot.length', 'plot.address_street',
                    'plot.address_city', 'plot.address_zip',
                    'plot.owner_orig_id'],
     'collection_udf_keys': ['plot.udf:Stewardship']},
)

INSTANCE_FIELD_ERRORS = {
    'no_field_groups': _('Must be a non-empty list'),

    'group_has_no_header': _(
        'Every mobile field group must have a non-empty header'),

    'group_has_no_keys': _(
        'All mobile field groups must have either a "field_keys" or '
        '"collection_udf_keys" containing a non-empty list'),

    'group_has_both_keys': _(
        'Mobile field groups cannot contain both "field_keys" and '
        '"collection_udf_keys" properties'),

    'group_has_no_sort_key': _(
        'Collection field groups must have a non-empty "sort_key" property '
        'defined'),

    'group_has_missing_cudf': _(
        'Collection field groups can only contain existing custom collection '
        'fields'),

    'group_has_invalid_sort_key': _(
        'The "sort_key" property of a collection field group must be the name '
        'of a field on present on every collection field in the group'),

    'duplicate_fields': _('Fields cannot be specified more than once'),

    'group_missing_model': _(
        'Normal field groups need a model property of either "tree" or "plot"'
    ),

    'group_invalid_model': _(
        'Normal field groups can only have keys that match their "model"'
    ),

    'missing_field': _(
        'Normal field groups may only contain existing fields. If you specify '
        'a custom field, it cannot be a collection field'),
}


ALERT_IDENTIFIER_PATTERN = re.compile(r'udf:(tree|plot):(\d+)\..+')


def advanced_search_fields(instance, user):
    from treemap.models import Tree, MapFeature  # prevent circular import

    def make_display_filter(feature_name):
        if feature_name == 'Plot':
            plural = _('empty planting sites')
            feature_name = 'EmptyPlot'
        else:
            plural = get_plural_feature_name(feature_name)

        return {
            'label': _('Show %(models)s') % {'models': plural.lower()},
            'model': feature_name
        }

    def get_plural_feature_name(feature_name):
        if feature_name == 'Tree':
            Feature = Tree
        else:
            Feature = MapFeature.get_subclass(feature_name)
        return Feature.terminology(instance)['plural']

    def get_visible_fields(field_infos, user):
        visible_fields = []
        for field_info in field_infos:
            model, field_name = _parse_field_info(instance, field_info)
            visible_fields.append(field_info)
            # FIXME add correct permissions
            #if model.field_is_visible(user, field_name):
            #    visible_fields.append(field_info)
        return visible_fields

    fields = copy.deepcopy(instance.search_config)
    fields = {category: get_visible_fields(field_infos, user)
              for category, field_infos in fields.iteritems()}

    for field_info in fields.get('missing', []):
        _set_missing_search_label(instance, field_info)
        field_info['search_type'] = 'ISNULL'
        field_info['value'] = 'true'

    fields['display'] = [make_display_filter('Tree'),
                         make_display_filter('Plot')]
    fields['display'] += [
        make_display_filter(feature)
        for feature in sorted(instance.map_feature_types) if feature != 'Plot']

    num = 0
    for filters in fields.itervalues():
        for field in filters:
            # It makes styling easier if every field has an identifier
            id = "%s_%s" % (field.get('identifier', ''), num)
            id = id.replace(' ', '_')
            field['id'] = id
            num += 1

    more = []
    for feature_name in sorted(instance.map_feature_types):
        if feature_name in fields and feature_name != 'Plot':
            filters = fields.pop(feature_name)
            filters = get_visible_fields(filters, user)

            if len(filters) > 0:
                more.append({
                    'name': feature_name,
                    'title': get_plural_feature_name(feature_name),
                    'fields': filters
                })
    fields['more'] = more

    return fields


def mobile_search_fields(instance):
    from treemap.templatetags.form_extras import (field_type_label_choices,
                                                  ADD_BLANK_NEVER)
    search_fields = copy.deepcopy(instance.mobile_search_fields)
    for field in search_fields['standard']:
        identifier = field['identifier']
        alert_info = get_alert_field_info(identifier, instance)
        if alert_info is not None:
            field.update(alert_info)
            continue

        Model, field_name = _parse_field_info(instance, field)
        set_search_field_label(instance, field)
        field_type, __, __, choices = field_type_label_choices(
            Model, field_name, add_blank=ADD_BLANK_NEVER)

        if identifier == 'species.id':
            field['search_type'] = 'SPECIES'
        elif field_type in {'int', 'float'}:
            field['search_type'] = 'RANGE'
        elif field_type in {'date', 'datetime'}:
            field['search_type'] = 'DATERANGE'
        elif field_type == 'string':
            field['search_type'] = 'STRING'
        elif field_type == 'bool':
            field['search_type'] = 'BOOL'
        elif field_type == 'choice':
            field['search_type'] = 'CHOICE'
        elif field_type == 'multichoice':
            field['search_type'] = 'MULTICHOICE'

        if choices:
            field['choices'] = choices

    for field in search_fields['missing']:
        _set_missing_search_label(instance, field)

    return search_fields


def _set_missing_search_label(instance, field_info):
    label = get_search_field_label(instance, field_info)
    field_info['label'] = _('Show Missing %(field)s') % {'field': label}


def set_search_field_label(instance, field_info):
    if 'label' not in field_info:
        field_info['label'] = get_search_field_label(instance, field_info)
    return field_info


def get_search_field_label(instance, field_info):
    """
    Searches for missing data are controlled by fields, and those fields
    need labels. Two wrinkles: 1) Fields like species.id and mapFeaturePhoto.id
    need special handling. 2) Fields from all models are shown in the
    "Missing Data" category, so prefix the field name with the model name.
    """
    from treemap.templatetags.form_extras import field_type_label_choices
    Model, field_name = _parse_field_info(instance, field_info)
    if field_name == 'id':
        if hasattr(Model, 'terminology'):
            label = Model.terminology(instance)['plural']
        else:
            label = Model._meta.verbose_name_plural
    else:
        __, label, __, __ = field_type_label_choices(Model, field_name, '')
        if hasattr(Model, 'terminology'):
            prefix = force_text(Model.terminology(instance)['singular'])
        else:
            prefix = force_text(Model._meta.verbose_name)
        label = force_text(label)
        if not label.startswith(prefix):
            label = "%s %s" % (prefix, label)
    return label


def _parse_field_info(instance, field_info):
    from treemap.util import get_model_for_instance
    model_name, field_name = field_info['identifier'].split('.', 2)
    Model = get_model_for_instance(model_name, instance)
    return Model, field_name


def get_udfc_search_fields(instance, user):
    from treemap.models import InstanceUser
    from treemap.udf import UDFModel
    from treemap.util import to_object_name, leaf_models_of_class
    from treemap.lib.perms import udf_write_level, READ, WRITE

    try:
        iu = instance.instanceuser_set.get(user__pk=user.pk)
    except InstanceUser.DoesNotExist:
        iu = None

    data = DotDict({'models': set(), 'udfc': {}})
    for clz in leaf_models_of_class(UDFModel):
        model_name = clz.__name__
        if model_name not in ['Tree'] + instance.map_feature_types:
            continue
        for k, v in clz.collection_udf_settings.items():
            udfds = (u for u in udf_defs(instance, model_name) if u.name == k)
            for udfd in udfds:
                if udf_write_level(iu, udfd) in (READ, WRITE):
                    _base_nest_path = 'udfc.%s.' % (to_object_name(k))
                    ids_nest_path = ('%sids.%s'
                                     % (_base_nest_path,
                                        to_object_name(model_name)))
                    models_nest_path = ('%smodels.%s' %
                                        (_base_nest_path,
                                         to_object_name(model_name)))
                    data[ids_nest_path] = udfd.pk
                    data[models_nest_path] = {
                        'udfd': udfd,
                        'fields': udfd.datatype_dict[0]['choices']
                    }
                    p = 'udfc.%s.' % to_object_name(k)
                    data[p + 'action_verb'] = v['action_verb']
                    data[p + 'range_field_key'] = v['range_field_key']
                    data[p + 'action_field_key'] = v['action_field_key']
                    data['models'] |= {clz}

    return data


def get_alert_field_info(identifier, instance):
    from treemap.util import get_model_for_instance
    alert_match = ALERT_IDENTIFIER_PATTERN.match(identifier)
    if alert_match:
        model_name, pk = alert_match.groups()
        Model = get_model_for_instance(model_name, instance)
        udf_def = next(udf for udf in udf_defs(instance) if udf.pk == int(pk))
        display_name = force_text(Model.terminology(instance)['singular'])
        return {
            'identifier': identifier,
            'search_type': 'DEFAULT',
            'default_identifier': udf_def.full_name,
            'label': 'Open %(model)s Alerts' % {'model': display_name},
        }
    return None
