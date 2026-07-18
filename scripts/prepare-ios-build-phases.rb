#!/usr/bin/env ruby
# frozen_string_literal: true

require 'xcodeproj'

requested_paths = ARGV.select { |path| File.exist?(path) }
project_paths = (requested_paths + Dir['ios/*.xcodeproj'] + Dir['ios/Pods/*.xcodeproj']).uniq

raise 'No Xcode project found' if project_paths.empty?

project_paths.uniq.each do |project_path|
  project = Xcodeproj::Project.open(project_path)
  changed = false

  project.targets.each do |target|
    target.build_configurations.each do |configuration|
      settings = configuration.build_settings
      {
        'GCC_TREAT_WARNINGS_AS_ERRORS' => 'NO',
        'SWIFT_TREAT_WARNINGS_AS_ERRORS' => 'NO',
        'CLANG_WARN_DOCUMENTATION_COMMENTS' => 'NO'
      }.each do |key, value|
        next if settings[key] == value

        settings[key] = value
        changed = true
      end

      %w[OTHER_CFLAGS OTHER_CPLUSPLUSFLAGS OTHER_SWIFT_FLAGS].each do |key|
        value = settings[key]
        next if value.nil?

        normalized = Array(value).reject do |flag|
          %w[-Werror -warnings-as-errors -fatal_warnings].include?(flag.to_s)
        end
        next if normalized == Array(value)

        settings[key] = value.is_a?(Array) ? normalized : normalized.join(' ')
        changed = true
      end
    end
  end

  unless File.basename(project_path) == 'Pods.xcodeproj'
    project.targets.each do |target|
      target.copy_files_build_phases.each do |phase|
        phase.files.dup.each do |build_file|
          reference = build_file.file_ref
          reference ||= build_file.product_ref if build_file.respond_to?(:product_ref)
          name = if reference
                   reference.respond_to?(:display_name) ? reference.display_name : reference.to_s
                 else
                   build_file.display_name
                 end
          next unless name.to_s.include?('ExpoModulesJSI')

          if phase.respond_to?(:remove_build_file)
            phase.remove_build_file(build_file)
          else
            phase.files.delete(build_file)
            build_file.remove_from_project
          end
          changed = true
          puts "Removed static ExpoModulesJSI from #{target.name} / #{phase.display_name}"
        end
      end
    end
  end

  if changed
    project.save
    puts "Prepared #{project_path}"
  else
    puts "No build-phase adjustment required for #{project_path}"
  end
end
